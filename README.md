# Imagine Dragons on air — התראה בכל פעם ששיר שלהם מתנגן בגלגלצ

קורא את פיד ה‑XML של גלגלצ ("מה מתנגן עכשיו"), ומתי שמזהה שיר של **Imagine Dragons**
שולח התראה לטלפון.

- רץ בחינם על GitHub Actions — לא צריך שרת ולא צריך שהמחשב יהיה דלוק.
- התראה אחת לכל השמעה: שיר שנשאר על הפיד בין בדיקה לבדיקה לא ישלח שוב.
- ערוצי התראה לבחירה: Telegram, Pushover, ntfy, או כל webhook (Slack/Discord).
- אפשר לעקוב אחרי כל אמן, לא רק Imagine Dragons.
- בלי תלויות (Node נקי) ועם בדיקות.

```
$ npm run check -- --dry-run --verbose
watching Imagine Dragons on https://glzxml.blob.core.windows.net/dalet/glglz-onair/onair.xml
feed: 2 entries
  - Imagine Dragons – Believer (10:04)
  - Oasis – Wonderwall (10:00)

🎧 Imagine Dragons מתנגנים עכשיו בגלגלצ
🎵 Believer
🕒 10:04
https://glz.co.il/glglz

notified: Imagine Dragons – Believer
```

## הקמה ב‑5 דקות

### 1. בחירת ערוץ ההתראה

הכי פשוט — **Telegram**:

1. פותחים צ׳אט עם `@BotFather`, שולחים `/newbot` ומקבלים טוקן.
2. שולחים הודעה כלשהי לבוט החדש.
3. נכנסים ל‑`https://api.telegram.org/bot<TOKEN>/getUpdates` ולוקחים משם את `chat.id`.

אפשרויות נוספות: `pushover`, `ntfy` (בלי חשבון — בוחרים שם טופיק ומנויים עליו באפליקציה),
`webhook` (Slack/Discord/כל דבר שמקבל JSON) ו‑`console` (רק מדפיס — טוב לבדיקות).
כל המשתנים נמצאים ב‑`.env.example`.

### 2. הרצה מקומית

```bash
cp .env.example .env     # ולמלא את הערכים
npm run check -- --dry-run --verbose   # בדיקה אחת, בלי לשלוח כלום
npm run check                          # בדיקה אחת ושליחה אמיתית
npm run watch -- --interval 45s        # מעקב רציף עד שעוצרים
```

### 3. הרצה אוטומטית ב‑GitHub Actions

ב‑**Settings → Secrets and variables → Actions** מוסיפים:

| שם | סוג | ערך |
| --- | --- | --- |
| `NOTIFIERS` | Variable | `telegram` (או `ntfy`, `pushover`, `webhook`, מופרד בפסיקים) |
| `TELEGRAM_BOT_TOKEN` | Secret | הטוקן מ‑BotFather |
| `TELEGRAM_CHAT_ID` | Secret | ה‑chat id שלך |

זהו. `.github/workflows/imagine-dragons.yml` בודק את הפיד **כל 5 דקות**.

שתי נקודות שחשוב להכיר ב‑GitHub Actions:

- **cron רץ רק מברנץ׳ ברירת המחדל** של הריפו. כל עוד ה‑workflow לא מוזג לשם,
  אפשר להריץ ידנית מלשונית Actions (כפתור *Run workflow*).
- לוח הזמנים של GitHub לא מדויק — לפעמים יש עיכוב של כמה דקות. אם הפיד של גלגלצ
  כולל גם את השירים הקודמים (ולא רק את הנוכחי), זה לא מזיק: הקוד קורא את כל הרשומות
  ולא רק את הראשונה, אז השיר עדיין ייתפס, רק עם עיכוב קטן בהתראה.
  לכיסוי מלא בלי תלות בגלגלצ — מריצים `npm run watch` על מחשב שדלוק תמיד (ראו למטה).

## הגדרות

`config/watchlist.json`:

```json
{
  "feedUrl": "https://glzxml.blob.core.windows.net/dalet/glglz-onair/onair.xml",
  "pollSeconds": 45,
  "dedupeMinutes": 30,
  "artists": [
    { "name": "Imagine Dragons", "aliases": ["אימג'ין דרגונס"] }
  ]
}
```

| שדה | משמעות |
| --- | --- |
| `artists[].name` | שם האמן כפי שיופיע בהתראה |
| `artists[].aliases` | כתיבים נוספים (אנגלית/עברית). ההשוואה ממילא מתעלמת מאותיות גדולות, פיסוק וגרשיים |
| `artists[].matchFields` | ברירת מחדל `["artist","title"]` — כך נתפס גם "Imagine Dragons feat. JID" וגם קאבר שמזכיר אותם בשם השיר |
| `dedupeMinutes` | חלון שבתוכו אותה השמעה לא תדווח פעמיים (ברירת מחדל 30 דקות) |
| `pollSeconds` | תדירות הבדיקה במצב `--watch` |

אפשר גם בלי לערוך קובץ: `ARTISTS="Imagine Dragons,Coldplay"` או
`npm run check -- --artist "Imagine Dragons"`.

## דגלים

```
node src/check.js [--watch] [--interval 45s] [--duration 5m] [--dry-run]
                  [--notifiers telegram,ntfy] [--artist "Imagine Dragons"]
                  [--feed <url>] [--config <path>] [--state <path>] [--verbose]
```

## אם ההתראות לא מגיעות

```bash
npm run feed
```

מדפיס את ה‑XML הגולמי של גלגלצ ואת מה שהמפענח הוציא ממנו. הפיד לא מתועד בשום מקום
ואין הבטחה שהתחנה לא תשנה אותו, ולכן המפענח לא מקובע למבנה אחד: הוא מזהה שדות לפי
המשמעות של השם שלהם (`ARTIST`, `artist=`, `מבצע`, וגם שדה אחד שמכיל
`Imagine Dragons - Believer`), יודע לקרוא היסטוריה מקוננת, ומתעלם משדות של שם התוכנית.
אם בכל זאת לא נמצא שום שדה שנראה כמו שיר — הוא מחפש את שם האמן בטקסט של כל הפיד
ומדפיס אזהרה. הפלט של `npm run feed` הוא מה שצריך כדי להוסיף כלל מדויק יותר.

## מעקב רציף על מחשב שדלוק תמיד

```ini
# /etc/systemd/system/glglz-watch.service
[Service]
WorkingDirectory=/opt/glglz-artist-watch
EnvironmentFile=/opt/glglz-artist-watch/.env
ExecStart=/usr/bin/node src/check.js --watch
Restart=always

[Install]
WantedBy=multi-user.target
```

## מבנה הקוד

| קובץ | תפקיד |
| --- | --- |
| `src/check.js` | ה‑CLI: מושך, מפענח, מסנן, שולח, זוכר |
| `src/feed.js` | הורדת הפיד (עם ניסיונות חוזרים ובלי cache) |
| `src/xml.js` | קורא XML קטן וסלחני, בלי תלויות |
| `src/parse.js` | XML → רשימת שירים `{artist, title, time}` |
| `src/match.js` | האם זה האמן שאנחנו מחכים לו (נרמול עברית/אנגלית) |
| `src/state.js` | מה כבר דווח, כדי לא לשלוח פעמיים |
| `src/notify.js`, `src/notifiers/` | ערוצי ההתראה |

```bash
npm test
```
