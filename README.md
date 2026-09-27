# הרדיו של שי 📻

אפליקציה ל-Windows ול-Android שמציגה את האתר
**https://shay-radio-il.netlify.app/**

האפליקציה טוענת תמיד את האתר החי, ולכן **כל שינוי באתר מופיע מיד באפליקציה** – אין צורך לבנות או להתקין מחדש.

| פלטפורמה | טכנולוגיה | קובץ התקנה |
|---|---|---|
| Windows | Electron | `shay-radio-setup-<גרסה>.exe` |
| Android | Capacitor (Electron לא תומך ב-Android) | `shay-radio.apk` |

## איך מקבלים את קבצי ההתקנה

הבנייה מתבצעת אוטומטית ב-GitHub Actions בכל push:

1. נכנסים ללשונית **Actions** במאגר ← הריצה האחרונה של **Build apps**.
2. בתחתית העמוד, תחת **Artifacts**, מורידים:
   - `shay-radio-windows` – תוכנת ההתקנה ל-Windows.
   - `shay-radio-android` – קובץ ה-APK לטלפון.

כדי ליצור **Release** קבוע עם שני הקבצים, דוחפים תגית גרסה:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

### התקנה ב-Windows
מריצים את קובץ ה-`exe`. אם מופיעה הודעת SmartScreen ("Windows protected your PC") לוחצים **More info ← Run anyway** (הקובץ אינו חתום דיגיטלית).

### התקנה ב-Android
מעבירים את `shay-radio.apk` לטלפון ופותחים אותו. בפעם הראשונה צריך לאשר "התקנה ממקורות לא ידועים".

## מה האפליקציה עושה
- מציגה את האתר במסך מלא, עם השם והאייקון "הרדיו של שי".
- המוזיקה ממשיכה להתנגן כשהחלון ממוזער / כשהאפליקציה ברקע.
- קישורים לאתרים אחרים נפתחים בדפדפן הרגיל.
- בלי אינטרנט מוצג מסך "אין חיבור" עם כפתור "נסו שוב".
- Windows: ‏F5 רענון, F11 מסך מלא.
- Android: כפתור "חזור" חוזר אחורה באתר; בעמוד הראשון הוא מעביר את האפליקציה לרקע (הרדיו ממשיך לנגן).

## פיתוח מקומי

```bash
npm install
npm start                # הפעלת אפליקציית Windows/desktop
npm run dist:win         # בניית תוכנת התקנה ל-Windows (על מחשב Windows)
npx cap sync android     # עדכון פרויקט ה-Android
npx cap open android     # פתיחה ב-Android Studio
```

כתובת האתר מוגדרת ב-`electron/main.js` (`SITE_URL`) וב-`capacitor.config.json` (`server.url`).
האייקון נמצא ב-`resources/icon.png` (מקור: `resources/icon.svg`); לאחר שינוי מריצים
`npx capacitor-assets generate --android` ומעתיקים אותו ל-`build/icon.png`.
