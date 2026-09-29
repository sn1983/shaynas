package il.shayradio.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

/**
 * Plays the radio natively (ExoPlayer) for as long as the app is open.
 *
 * The site still shows the stations and buttons, but on Android the actual
 * audio is played here instead of in the WebView: it keeps playing in the
 * background / with the screen off, plays every stream format (e.g. ECO99FM),
 * reconnects by itself after network drops, and is controlled from a
 * notification with play / stop / exit (also on the lock screen and headphones).
 */
public class RadioService extends Service {

    /** Receives player state changes (to update the site's display). */
    public interface Listener {
        /** state: "playing", "buffering", "paused" or "error". */
        void onState(String state);

        /** Close the app (the notification's exit button). */
        void exit();
    }

    static final String ACTION_START = "il.shayradio.app.START";
    static final String ACTION_PLAY = "il.shayradio.app.PLAY";
    static final String ACTION_STOP = "il.shayradio.app.STOP";
    static final String ACTION_EXIT = "il.shayradio.app.EXIT";
    static final String EXTRA_URL = "url";
    static final String EXTRA_TITLE = "title";

    private static final String CHANNEL_ID = "radio_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final int MAX_RETRY_DELAY_MS = 30000;
    private static final int RESUME_CHECK_MS = 5000;
    private static final int RESUME_CHECK_MAX = 12 * 60; // give up auto-resume after ~1 hour

    static volatile Listener listener;

    private static volatile RadioService instance;
    private static final Handler main = new Handler(Looper.getMainLooper());

    // Last requested station, kept so "play" from the notification can reconnect.
    private static String url;
    private static String title = "";
    private static float volume = 1f;

    private ExoPlayer player;
    private MediaSessionCompat session;
    private boolean wantPlaying;
    private int retries;
    // Paused because another app took over the audio; resume when it's quiet again.
    private boolean interrupted;
    private int resumeChecks;
    private AudioManager audioManager;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    // ----- Called from the rest of the app (any thread) -----

    /** Make sure the service (and its notification) is running. App must be in the foreground. */
    static void ensureStarted(Context context) {
        if (instance != null) return;
        launch(context, new Intent(context, RadioService.class).setAction(ACTION_START));
    }

    /** Play a station. Starts the service if needed (only allowed with the app in the foreground). */
    static void playStream(Context context, String streamUrl, String stationTitle, boolean appInForeground) {
        main.post(() -> {
            url = streamUrl;
            title = stationTitle != null ? stationTitle : "";
            RadioService s = instance;
            if (s != null) {
                s.startPlayback();
            } else if (appInForeground) {
                launch(context, new Intent(context, RadioService.class)
                    .setAction(ACTION_PLAY).putExtra(EXTRA_URL, streamUrl).putExtra(EXTRA_TITLE, title));
            } else {
                notifyState("error");
            }
        });
    }

    static void stopStream() {
        main.post(() -> {
            RadioService s = instance;
            if (s != null) s.stopPlayback();
            else notifyState("paused");
        });
    }

    static void setVolume(float v) {
        main.post(() -> {
            volume = Math.max(0f, Math.min(1f, v));
            RadioService s = instance;
            if (s != null && s.player != null) s.player.setVolume(volume);
        });
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, RadioService.class));
    }

    private static void launch(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // Android refused (app in the background); it is started again when the app opens.
        }
    }

    private static void notifyState(String state) {
        Listener l = listener;
        if (l != null) l.onState(state);
    }

    // ----- Service -----

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("Mozilla/5.0 (Linux; Android) ShayRadio")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000);
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this, http)))
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(), /* handleAudioFocus= */ true)
            .setHandleAudioBecomingNoisy(true) // pause when headphones are unplugged
            .setWakeMode(C.WAKE_MODE_NETWORK)   // keep CPU + Wi-Fi awake while playing
            .build();
        player.setVolume(volume);
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    retries = 0;
                    interrupted = false;
                    notifyState("playing");
                } else if (wantPlaying) {
                    notifyState("buffering");
                }
                refresh();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (playWhenReady || !wantPlaying) return;
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY) {
                    // Headphones unplugged: a deliberate stop, don't restart by ourselves.
                    wantPlaying = false;
                    notifyState("paused");
                    refresh();
                } else if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
                    // Another app started playing: wait until it's quiet, then resume.
                    interrupted = true;
                    resumeChecks = 0;
                    main.removeCallbacks(resumeCheck);
                    main.postDelayed(resumeCheck, RESUME_CHECK_MS);
                    notifyState("buffering");
                    refresh();
                }
            }

            @Override
            public void onPlaybackSuppressionReasonChanged(int reason) {
                // A phone call / short sound (navigation, voice message) paused us
                // temporarily. When it ends, reconnect so we play live, not old audio.
                if (reason == Player.PLAYBACK_SUPPRESSION_REASON_NONE && wantPlaying && !player.isPlaying()) {
                    startPlayback();
                }
                refresh();
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && wantPlaying) {
                    retryLater(); // live stream ended unexpectedly: reconnect
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                // Network drop, server hiccup...: keep reconnecting while the user wants
                // the radio on (waiting a little longer each time, up to 30 s).
                if (wantPlaying) {
                    retryLater();
                } else {
                    notifyState("error");
                    refresh();
                }
            }
        });

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        registerNetworkCallback();

        session = new MediaSessionCompat(this, "ShayRadio");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { startPlayback(); }
            @Override public void onPause() { stopPlayback(); }
            @Override public void onStop() { stopPlayback(); }
            @Override public void onCustomAction(String action, android.os.Bundle extras) {
                if (ACTION_EXIT.equals(action)) exitApp();
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Always become a foreground service right away (Android requires it).
        refresh();
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PLAY.equals(action)) {
            String u = intent.getStringExtra(EXTRA_URL);
            if (u != null) {
                url = u;
                String t = intent.getStringExtra(EXTRA_TITLE);
                title = t != null ? t : "";
            }
            startPlayback();
        } else if (ACTION_STOP.equals(action)) {
            stopPlayback();
        } else if (ACTION_EXIT.equals(action)) {
            exitApp();
        }
        return START_NOT_STICKY;
    }

    private void startPlayback() {
        if (url == null) return;
        main.removeCallbacks(retryRunnable);
        main.removeCallbacks(resumeCheck);
        interrupted = false;
        wantPlaying = true;
        MediaItem.Builder item = new MediaItem.Builder().setUri(url);
        if (url.toLowerCase().contains(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        player.setMediaItem(item.build());
        player.prepare();
        player.setPlayWhenReady(true);
        notifyState("buffering");
        refresh();
    }

    private void stopPlayback() {
        main.removeCallbacks(retryRunnable);
        main.removeCallbacks(resumeCheck);
        wantPlaying = false;
        interrupted = false;
        retries = 0;
        player.stop();
        notifyState("paused");
        refresh();
    }

    private final Runnable retryRunnable = () -> {
        if (wantPlaying) startPlayback();
    };

    private void retryLater() {
        int delay = Math.min(MAX_RETRY_DELAY_MS, 2000 << Math.min(retries, 4)); // 2,4,8,16,30 s
        retries++;
        notifyState("buffering");
        refresh();
        main.removeCallbacks(retryRunnable);
        main.postDelayed(retryRunnable, delay);
    }

    /** After another app took the audio: resume once nothing else is playing and no call is on. */
    private final Runnable resumeCheck = new Runnable() {
        @Override
        public void run() {
            if (!wantPlaying || !interrupted) return;
            boolean quiet = audioManager == null
                || (!audioManager.isMusicActive() && audioManager.getMode() == AudioManager.MODE_NORMAL);
            if (quiet) {
                startPlayback();
            } else if (++resumeChecks < RESUME_CHECK_MAX) {
                main.postDelayed(this, RESUME_CHECK_MS);
            } else {
                stopPlayback(); // waited an hour: give up
            }
        }
    };

    /** Reconnect right away when the internet comes back. */
    private void registerNetworkCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                main.post(() -> {
                    if (wantPlaying && !interrupted && player != null && !player.isPlaying()) {
                        retries = 0;
                        startPlayback();
                    }
                });
            }
        };
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback);
        } catch (Exception e) {
            networkCallback = null;
        }
    }

    /** Close the whole app (used by the exit button inside the app). */
    static void requestExit(Context context) {
        main.post(() -> {
            RadioService s = instance;
            if (s != null) {
                s.exitApp();
            } else {
                Listener l = listener;
                if (l != null) l.exit();
            }
        });
    }

    private void exitApp() {
        stopPlayback();
        Listener l = listener;
        if (l != null) l.exit();
        stopSelf();
    }

    // ----- Notification -----

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent i = new Intent(this, RadioService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressLint("MissingPermission")
    private void refresh() {
        boolean playing = wantPlaying;
        String appName = getString(R.string.app_name);
        String text;
        if (!playing) {
            text = "עצור - לחצו ▶ כדי לנגן";
        } else if (interrupted) {
            text = "הושהה בגלל צליל אחר - ימשיך אוטומטית";
        } else if (retries > 0 && (player == null || !player.isPlaying())) {
            text = "מתחבר מחדש...";
        } else if (player != null && player.isPlaying()) {
            text = title.isEmpty() ? "מנגן" : "מנגן: " + title;
        } else {
            text = title.isEmpty() ? "מתחבר..." : "מתחבר: " + title;
        }

        session.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title.isEmpty() ? appName : title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, appName)
            .build());
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP)
            .addCustomAction(ACTION_EXIT, "יציאה", R.drawable.ic_notif_close)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());

        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Action playStop = playing
            ? new NotificationCompat.Action(R.drawable.ic_notif_stop, "עצור", serviceIntent(ACTION_STOP, 2))
            : new NotificationCompat.Action(R.drawable.ic_notif_play, "נגן", serviceIntent(ACTION_PLAY, 1));
        NotificationCompat.Action exit =
            new NotificationCompat.Action(R.drawable.ic_notif_close, "יציאה", serviceIntent(ACTION_EXIT, 3));

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_radio)
            .setContentTitle(appName)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .addAction(playStop)
            .addAction(exit)
            .setStyle(new MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1))
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
        } catch (Exception e) {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "ניגון הרדיו", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        main.removeCallbacks(retryRunnable);
        main.removeCallbacks(resumeCheck);
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {
                // already unregistered
            }
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        notifyState("paused");
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // App swiped away from the recent apps list: close everything.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
