# مجلد الخطوط (Fonts Directory)

**يجب** وضع ملفين هنا لتعمل اللغة العربية في PDF بشكل صحيح:

## ⚠️ لماذا هذا مهم؟
PDFKit لا يحتوي على خطوط عربية افتراضية. إذا لم تضع خطوطاً هنا، سيظهر النص العربي في PDF على شكل مربعات □□□□.

## الملفات المطلوبة:

### 1. `Tajawal-Regular.ttf` (~330 KB)
### 2. `Tajawal-Bold.ttf` (~330 KB)

## من أين تحصل عليها (مجاناً)؟

### الخيار 1: Google Fonts (الأسهل)
1. اذهب إلى: **https://fonts.google.com/specimen/Tajawal**
2. انقر على زر **"Download family"** بالأعلى
3. استخرج ملف ZIP الذي يحتوي على جميع المتغيرات
4. من داخل مجلد `static/`، انسخ ملفين فقط:
   - `Tajawal-Regular.ttf`
   - `Tajawal-Bold.ttf`

### الخيار 2: GitHub مباشر
1. اذهب إلى: **https://github.com/google/fonts/raw/main/ofl/tajawal/Tajawal-Regular.ttf**
2. احفظ باسم `Tajawal-Regular.ttf`
3. ثم: **https://github.com/google/fonts/raw/main/ofl/tajawal/Tajawal-Bold.ttf**
4. احفظ باسم `Tajawal-Bold.ttf`

### الخيار 3: jsDelivr CDN
```
curl -L "https://cdn.jsdelivr.net/gh/google/fonts/ofl/tajawal/Tajawal-Regular.ttf" -o fonts/Tajawal-Regular.ttf
curl -L "https://cdn.jsdelivr.net/gh/google/fonts/ofl/tajawal/Tajawal-Bold.ttf" -o fonts/Tajawal-Bold.ttf
```

## للأمان، تحقق من أن الملفين تم تحميلهما بشكل صحيح:

- يجب ألا يكون أي من الملفين **0 bytes**
- يجب أن يكون كل منهما **≥ 100 KB** في الحجم
- يجب أن يبدأ كل ملف بـ `0x00 0x01 0x00 0x00 0x00` (TTF magic number)

## ✅ التحقق من النجاح:

بعد رفع الملفات إلى GitHub وبعد نشر Render:
1. افتح صفحة التقرير في المتصفح (تعمل بدون الخطوط)
2. اضغط على **"📥 تحميل PDF"** 
3. إذا رأيت نصاً عربياً واضحاً في PDF = نجح كل شيء
4. إذا رأيت مربعات □□□□ = الخطوط لم ترفع بشكل صحيح

## في حال الفشل:

تأكد أنك رفعت ملفين منفصلين (Regular + Bold) وليس ملفاً واحداً فقط، وأنهما في **المجلد الرئيسي `fonts/`** مباشرة (ليس داخل مجلد فرعي).

