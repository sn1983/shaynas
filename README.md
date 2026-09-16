# Morning SMS — הודעת בוקר טוב לילדים

מנגנון אוטומטי ששולח SMS לילדים **כל בוקר ב‑07:00 שעון ישראל**.

- רץ בחינם על GitHub Actions (לא צריך שרת ולא צריך שהמחשב יהיה דלוק).
- מטפל נכון בשעון קיץ/חורף — תמיד 07:00 מקומי, לא 07:00 UTC.
- הודעה שונה בכל יום, מתוך מאגר הודעות שאפשר לערוך.
- תומך בכמה ספקי SMS: Twilio, Inforu, SMS4Free.

## התקנה מהירה

### 1. רשימת הנמענים

```bash
cp config/recipients.example.json config/recipients.json
```

וערוך את הקובץ:

```json
{
  "timezone": "Asia/Jerusalem",
  "sendAtHour": 7,
  "sendAtMinute": 0,
  "skipDays": [],
  "recipients": [
    { "name": "נועה", "phone": "050-1234567", "enabled": true },
    { "name": "איתי", "phone": "052-1234567", "enabled": true,
      "messages": ["בוקר טוב {name}! שיהיה לך יום מעולה באימון 💪"] }
  ]
}
```

| שדה | משמעות |
| --- | --- |
| `phone` | אפשר בפורמט מקומי (`050-1234567`) או בינלאומי (`+972501234567`) |
| `enabled` | `false` משתיק נמען בלי למחוק אותו |
| `messages` | רשימת הודעות אישית לנמען. אם אין — נלקח ממאגר `config/messages.json` |
| `skipDays` | ימים שלא שולחים בהם, למשל `["saturday"]` |
| `sendAtHour` / `sendAtMinute` | שעת השליחה המקומית |

`config/recipients.json` נמצא ב‑`.gitignore` — מספרי הטלפון לא נכנסים לריפו.

### 2. מאגר ההודעות

`config/messages.json` הוא מערך של הודעות. `{name}` מוחלף בשם הנמען.
בכל יום נבחרת הודעה אחרת מהמאגר, במחזוריות קבועה.

### 3. בדיקה בלי לשלוח באמת

```bash
npm run dry-run
```

מדפיס למסך בדיוק מה היה נשלח ולמי, בלי לגעת בספק ה‑SMS.

### 4. חיבור ספק SMS

```bash
cp .env.example .env
```

ומלא את הפרטים של הספק שבחרת (`SMS_PROVIDER=twilio` / `inforu` / `sms4free`).

לשליחת מבחן אמיתית עכשיו, בלי להמתין לבוקר:

```bash
npm run send:now
```

### 5. הפעלת האוטומציה ב‑GitHub

ב‑`Settings → Secrets and variables → Actions` הוסף:

**Secrets:**

| שם | תוכן |
| --- | --- |
| `RECIPIENTS_JSON` | כל התוכן של `config/recipients.json` כשורה אחת |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | פרטי Twilio (או המקבילים של Inforu / SMS4Free) |

**Variables:**

| שם | תוכן |
| --- | --- |
| `SMS_PROVIDER` | `twilio`, `inforu` או `sms4free` |

זהו — מכאן ה‑workflow `.github/workflows/morning-sms.yml` רץ לבד כל בוקר.
אפשר גם להריץ ידנית מלשונית **Actions → Morning SMS → Run workflow**
(ברירת המחדל שם היא dry‑run, כדי לבדוק בלי לשלוח).

## איך נפתרת בעיית שעון הקיץ

Cron ב‑GitHub Actions רץ תמיד לפי UTC, וישראל נעה בין UTC+2 ל‑UTC+3.
לכן ה‑workflow מופעל **פעמיים** בכל יום — ב‑04:00 וב‑05:00 UTC — ו‑`src/schedule.js`
בודק מה השעה המקומית בפועל: רק ההרצה שנופלת על 07:00 בישראל שולחת, השנייה
יוצאת בלי לעשות כלום. יש בדיקה שמריצה שנה שלמה ומוודאת בדיוק שליחה אחת ליום.

חלון הסבילות הוא 45 דקות, כדי לספוג עיכוב של ה‑runner בלי סיכון לשליחה כפולה.

## הרצה על שרת משלך במקום GitHub Actions

אם עדיף לך crontab מקומי, השורה הבאה מספיקה (הקוד עצמו שומר על השעה הנכונה):

```cron
0 4,5 * * * cd /path/to/shaynas && /usr/bin/node src/send.js >> /var/log/morning-sms.log 2>&1
```

## פקודות

| פקודה | מה היא עושה |
| --- | --- |
| `npm run dry-run` | מדפיס את ההודעות בלי לשלוח |
| `npm run send:now` | שולח עכשיו, מתעלם משעת היעד |
| `npm run send` | שולח רק אם השעה המקומית היא שעת היעד (מה שה‑cron מריץ) |
| `npm test` | מריץ את הבדיקות |

דגלים נוספים ל‑`node src/send.js`:
`--only=נועה` (רק נמען אחד), `--provider=inforu`, `--dry-run`, `--force`,
`--tolerance=30`.

## הוספת ספק SMS נוסף

צור קובץ ב‑`src/providers/` שמייצא פונקציה המחזירה `{ name, send({ to, body }) }`,
ורשום אותה ב‑`src/providers/index.js`. שאר המערכת לא משתנה.
