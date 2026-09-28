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
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

/**
 * Runs for as long as the app is open. It:
 *  - keeps the app (and the WebView playing the stream) alive in the background
 *    and with the screen off, so Android doesn't stop the radio after a few minutes;
 *  - shows a notification with play / stop / exit buttons (the Android "tray"),
 *    which also appear on the lock screen and work with headphone buttons.
 */
public class RadioService extends Service {

    /** Implemented by the part of the app that controls the site's player. */
    public interface Controller {
        void play();
        void stop();
        void exit();
    }

    static final String ACTION_UPDATE = "il.shayradio.app.UPDATE";
    static final String ACTION_PLAY = "il.shayradio.app.PLAY";
    static final String ACTION_STOP = "il.shayradio.app.STOP";
    static final String ACTION_EXIT = "il.shayradio.app.EXIT";

    private static final String CHANNEL_ID = "radio_playback";
    private static final int NOTIFICATION_ID = 1;

    static volatile Controller controller;

    // Current state, shared with the rest of the app (same process).
    static volatile boolean playing = false;
    static volatile String title = "";
    private static volatile RadioService instance;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    /**
     * Update the player notification. If the service isn't running yet it is
     * started, but only when {@code appInForeground} is true: Android does not
     * allow starting it from the background (doing so can crash the app).
     */
    static void update(Context context, boolean isPlaying, String stationTitle, boolean appInForeground) {
        playing = isPlaying;
        if (stationTitle != null) title = stationTitle;
        RadioService running = instance;
        if (running != null) {
            mainHandler.post(running::refresh);
            return;
        }
        if (!appInForeground) return;
        Intent intent = new Intent(context, RadioService.class).setAction(ACTION_UPDATE);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // Android refused to start it from the background; the next time the
            // app is opened it will be started again.
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, RadioService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        session = new MediaSessionCompat(this, "ShayRadio");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { runController(ACTION_PLAY); }
            @Override public void onPause() { runController(ACTION_STOP); }
            @Override public void onStop() { runController(ACTION_STOP); }
            @Override public void onCustomAction(String action, android.os.Bundle extras) {
                if (ACTION_EXIT.equals(action)) runController(ACTION_EXIT);
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Always become a foreground service right away (Android requires it).
        refresh();
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PLAY.equals(action) || ACTION_STOP.equals(action) || ACTION_EXIT.equals(action)) {
            runController(action);
            // Show the new state right away; the page confirms it a moment later.
            if (ACTION_PLAY.equals(action)) playing = true;
            if (ACTION_STOP.equals(action)) playing = false;
            if (ACTION_EXIT.equals(action)) {
                playing = false;
                stopSelf();
                return START_NOT_STICKY;
            }
            refresh();
        }
        return START_NOT_STICKY;
    }

    private void refresh() {
        showNotification();
        updateLocks();
    }

    private void runController(String action) {
        Controller c = controller;
        if (c == null) {
            if (ACTION_EXIT.equals(action)) stopSelf();
            return;
        }
        if (ACTION_PLAY.equals(action)) c.play();
        else if (ACTION_STOP.equals(action)) c.stop();
        else if (ACTION_EXIT.equals(action)) c.exit();
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent i = new Intent(this, RadioService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressLint("MissingPermission")
    private void showNotification() {
        String appName = getString(R.string.app_name);
        String text = playing
            ? (title.isEmpty() ? "מנגן" : "מנגן: " + title)
            : "עצור - לחצו ▶ כדי לנגן";

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
            .setDeleteIntent(serviceIntent(ACTION_STOP, 4))
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
            // Not allowed to become a foreground service right now (started from
            // the background); just show/update the notification.
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

    // Keep the CPU and Wi-Fi awake only while the radio is actually playing.
    private void updateLocks() {
        if (playing) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ShayRadio:playback");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire();
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "ShayRadio:stream");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } else {
            releaseLocks();
        }
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        releaseLocks();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
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
