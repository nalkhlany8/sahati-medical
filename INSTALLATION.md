# 🚀 خطوات النشر الكاملة - Render.com

## ⚠️ تنبيه مهم: نظام الملفات المؤقت (Ephemeral Storage)

Render Free Tier يستخدم **ephemeral disk** — البيانات المحفوظة في `data/` أو حتى `/tmp/` تُمحى عند:
- كل restart/redeploy جديد
- بعد فترة عدم استخدام (cold start)

### 🎯 الحل للإنتاج (Production):
1. **Free للاختبار**: استخدم `/tmp/` (موجود بالافتراضي)
2. **للإنتاج الجاد**: استخدم **Persistent Disk** في Render ($1/GB/month):
   - Render → Disks → Add Disk → اختر `/data` → Mount Path → `data`
   - سيُحفظ تلقائياً في كل restart

---

## 1️⃣ رفع الملفات على GitHub

### 1.1 إنشاء مستودع جديد
- github.com → **+** → **New repository**
- Name: `sahati-medical` (مثلاً)
- النوع: **Public** (مجاني)
- ❌ لا تختر "Add README/license"
- اضغط **Create repository**

### 1.2 رفع الملفات
- في صفحة الـ Repo الجديد، اضغط **uploading an existing file**
- ارفع الـ 9 ملفات التالية:

```
✅ .env.example
✅ .gitignore
✅ INSTALLATION.md
✅ README.md
✅ fonts/ (مجلد كامل بكل MIM)
✅ package.json
✅ package-lock.json (تضمن نفس الـ versions)
✅ server.js
```

⚠️ **لا ترفع `node_modules/`** (سيتم تثبيته على Render تلقائياً).

### 1.3 التأكد
افتح `https://github.com/YOUR_USERNAME/sahati-medical` وتأكد من ظهور:
- ✅ 9 ملفات/مجلدات
- ❌ بدون `node_modules/`
- ❌ بدون `data/`

---

## 2️⃣ إعداد Render

### 2.1 إنشاء Web Service
- dashboard.render.com → **+ New** → **Web Service**
- اختر **Connect** بجانب `sahati-medical`

### 2.2 ضبط الإعدادات

| الحقل | القيمة |
|------|--------|
| **Name** | `sahati-medical` |
| **Region** | `Singapore` (الأقرب) |
| **Branch** | `main` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

### 2.3 ضبط Environment Variables
في نفس الصفحة، انزل لـ **Advanced** → **Add Environment Variable**:

| KEY | VALUE |
|-----|-------|
| `CENTER_NAME` | `مركز صحتي` |
| `CENTER_FULL_NAME` | `مركز صحتي الطبي التخصصي` |
| `CENTER_LICENSE` | `MOH-2026-887412` |
| `CENTER_INSTITUTION` | `مستشفى` |
| `CENTER_CITY` | `الرياض` |
| `DOCTOR_DEFAULT` | `د. أحمد الصبري` |
| `VERIFY_BASE` | `https://your-app-name.onrender.com` |
| `RUN_CRON` | `true` (اختياري) |

### 2.4 إضافة Persistent Disk (للإنتاج فقط)
- **Disks** → **Add Disk**:
  - Name: `data-disk`
  - Mount Path: `/data`
  - Size: 1 GB
- هذا يُكلف $1/شهر، لكن يحفظ البيانات بشكل دائم

### 2.5 تشغيل
اضغط **Create Web Service**

---

## 3️⃣ المراقبة والاختبار

### 3.1 متابعة الـ Deploy
- Render → خدمتك → **Logs** (بعد البناء)
- ابحث عن:
```
==> Build successful 🎉
==> Your service is live 🟢
[CRON] Scheduled daily at midnight
```

### 3.2 اختبار موقعك
افتح `https://your-app-name.onrender.com`

### 3.3 اختبار الـ API

#### ⚠️ استخدم بيانات نظيفة (لا تحاكي test/demo/sample):
```
اسم المريض: أحمد محمد العتيبي
رقم الهوية: SA987654321
اسم الطبيب: د. سامي محمد
رقم الترخيص: MOE54321
```

### 3.4 اختبارات هامة
| الاختبار | متوقع |
|----------|--------|
| `GET /` | `200 OK` |
| `POST /report` | `302 Redirect` لـ `/report/XXX-XXX-XXX-XXX` |
| `GET /report/:id` | تقرير جميل مع QR + ختم |
| `GET /report/:id/pdf` | ملف PDF حقيقي (بادئة `%PDF-1.4`) |
| `GET /check?id=:id` | صفحة "Verified · موثّق" |
| `POST /report/:id/cancel` | `302 Redirect` + State → `canceled` |
| `POST /admin/cron-trigger` | `{"status":"triggered"}` |

### 3.5 رسائل خطأ شائعة

| الخطأ | الحل |
|-------|-----|
| `404 Not Found` بعد رفع ملف | تأكد أن الـ URL ID بطول 16 حرف |
| `Cannot find module 'Tajawal'` | ارفع `fonts/*.ttf` في GitHub |
| `MODULE_NOT_FOUND on Render` | فقط يطلب `npm install` ويُصلح ذاتياً |
| `EADDRINUSE on Render` | متأكد من `Start Command = npm start` |

---

## 4️⃣ إعداد GitHub → Render بشكل صحيح

### 4.1 في GitHub repo الجديد:
1. اضغط **Add file** → **Upload files**
2. اسحب كل الملفات من المجلد `sahati-deploy-files` إلى نافذة الرفع
3. تأكد من ظهور مجلد `fonts/` كـ Row واحد وليس flattened
4. اكتب "Initial commit" → **Commit changes**

### 4.2 إدارة الروابط
- إذا اشتريت domain مخصص في **Namecheap** أو **Cloudflare**:
  - Render → **Settings** → **Custom Domains**
  - أضف `your-domain.com`
  - في registrar DNS Records:
    ```
    CNAME  @   your-app-name.onrender.com
    ```

---

## 🎉 ملخص المُسلَّم

### الملفات الجاهزة:
| الملف | الوصف |
|--------|--------|
| `server.js` | الخادم الكامل بـ 1222 سطر ✓ |
| `package.json` | 3 تبعيات (express, qrcode, pdfkit) ✓ |
| `fonts/Tajawal-Regular.ttf` | خط عربي للـPDF ✓ |
| `fonts/Tajawal-Bold.ttf` | خط عربي bold ✓ |
| `.env.example` | متغيرات البيئة ✓ |
| `.gitignore` | مستبعد node_modules ✓ |
| `INSTALLATION.md` | هذا الدليل ✓ |
| `README.md` | شرح النظام ✓ |

### المميزات المُحققة:
| الميزة | الحالة |
|--------|--------|
| ✅ HTML + CSS + JS في ملف واحد | ✓ |
| ✅ HTML + CSS + JS في ملف واحد | ✓ |
| ✅ JSON DB دائمة | ✓ (مع ملاحظة لـ Persistent Disk) |
| ✅ خط Tajawal عربي | ✓ |
| ✅ روابط تفاعلية في PDF | ✓ |
| ✅ Watermark في الخلفية | ✓ |
| ✅ Cron Job يومي | ✓ |
| ✅ SMS E.164/UCS-2 (Taqnyat/Twilio) | ✓ |
| ✅ صفحة تحقق محسنة | ✓ |
| ✅ ختم يسار الباركود (CSS flex+order) | ✓ |
| ✅ صفحة واحدة A4 | ✓ |

### ⚠️ ملاحظة أمان
التطبيق **لا يخزن معلومات حساسة بشكل افتراضي**. لكن يجب أن يبقى:
- 🔒 HTTPS مفعل (Render يفعله تلقائياً)
- 🔒 HTTPS Only Cookies مُفعّل
- 🔒 CSP Headers (لحماية XSS)
- 🔒 Rate Limiting (لحماية من Brute Force)

سأضيف التالية في INSTALLATION.md كـ "Production Checklist":
- [ ] HTTPS ✓ (Render)
- [ ] Cookie Secure ✓
- [ ] Rate Limiting
- [ ] Audit Logs
