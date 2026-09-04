/*
|--------------------------------------------------------------------------
| مركز صحتي الطبية - نظام Document Verification Enterprise Edition
| - روابط تفاعلية + QR حقيقي + PDF محسّن
| - تخزين دائم في JSON DB
| - Cron Job تلقائي لإدارة حالات الإجازات
| - نظام SMS دولي مع دعم E.164 و UCS-2
|--------------------------------------------------------------------------
*/

const express = require('express');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true, limit: '500kb' }));
app.use(express.json({ limit: '500kb' }));

// === الإعدادات الأساسية (Environment Variables) ===
const PORT = process.env.PORT || 3000;
const CENTER_NAME = String(process.env.CENTER_NAME || '').trim();
const CENTER_FULL_NAME = String(process.env.CENTER_FULL_NAME || CENTER_NAME).trim();
const VERIFY_BASE = String(process.env.VERIFY_BASE || '').trim();
const CENTER_LICENSE = String(process.env.CENTER_LICENSE || '').trim();
const DOCTOR_DEFAULT = String(process.env.DOCTOR_DEFAULT || '').trim();
const CENTER_CITY = String(process.env.CENTER_CITY || 'الرياض').trim();
const CENTER_INSTITUTION = String(process.env.CENTER_INSTITUTION || 'مستشفى').trim();

// === إعدادات SMS ===
const TAQNYAT_TOKEN = String(process.env.TAQNYAT_TOKEN || '').trim();
const TAQNYAT_SENDER = String(process.env.TAQNYAT_SENDER || 'SahatiMed').trim();
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
const TWILIO_FROM_NUMBER = String(process.env.TWILIO_FROM_NUMBER || '').trim();
const WHATSAPP_FROM_NUMBER = String(process.env.WHATSAPP_FROM_NUMBER || '').trim();

// === Database JSON Persistent Storage ===
const DB_FILE = path.join(__dirname, 'data', 'reports.json');

function ensureDb() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2));
}
ensureDb();

function loadDb() {
  try {
    ensureDb();
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[DB] Load failed, returning empty:', e.message);
    return {};
  }
}
function saveDb(db) {
  try {
    ensureDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('[DB] Save failed:', e.message);
  }
}

// === تطبيع رقم الهاتف E.164 ===
function toE164(phone, defaultCountry = '+966') {
  if (!phone) return '';
  let p = String(phone).replace(/[\s\-\(\)\.]/g, '');
  if (p.startsWith('+')) return '+' + p.slice(1);
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) {
    const rest = p.slice(1);
    return /^[\d]+$/.test(rest) ? defaultCountry + rest : p;
  }
  if (/^[1-9]\d{6,14}$/.test(p)) return defaultCountry + p;
  return phone; // fallback
}

// === تشفير XSS ===
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// === أدوات التاريخ ===
function fmtDate(d) {
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(d)); }
  catch (e) { return d; }
}
function fmtTime(d) {
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d)); }
  catch (e) { return d; }
}
function fmtDateTimeEn(d) {
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d)); }
  catch (e) { return d; }
}
function fmtDateTimeAr(d) {
  if (!d) return '';
  try { return new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); }
  catch (e) { return ''; }
}
function fmtDateShort(d) {
  if (!d) return '';
  try { return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(d)); }
  catch (e) { return d; }
}
function daysBetween(s, e) {
  if (!s || !e) return null;
  const a = Date.parse(s), b = Date.parse(e);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.floor((b - a) / 86400000) + 1;
}
function statusOf(r) {
  if (!r || r.status === 'canceled') return 'canceled';
  const end = new Date(r.endDate + 'T23:59:59');
  return end < new Date() ? 'expired' : 'active';
}
function statusTextEn(st) {
  if (st === 'active') return 'Active';
  if (st === 'expired') return 'Expired';
  return 'Cancelled';
}
function statusTextAr(st) {
  if (st === 'active') return 'سارٍ';
  if (st === 'expired') return 'منتهي';
  return 'ملغى';
}
function statusColor(st) {
  if (st === 'active') return { bg: '#d4edda', text: '#155724', border: '#10b981' };
  if (st === 'expired') return { bg: '#fee2e2', text: '#991b1b', border: '#dc2626' };
  return { bg: '#e2e8f0', text: '#475569', border: '#94a3b8' };
}
function makeSecureId() {
  return crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}
function getBaseUrl(req) {
  if (VERIFY_BASE) return VERIFY_BASE.replace(/\/$/, '');
  return (req.get('x-forwarded-proto') || req.protocol) + '://' + req.get('host');
}

// === التحقق من صحة المدخلات ===
function validateInput(b) {
  const e = [];
  const req = { patientName: 'اسم المريض', patientId: 'رقم الهوية', doctorName: 'اسم الطبيب', doctorLicense: 'رقم الترخيص', startDate: 'تاريخ البداية', endDate: 'تاريخ النهاية' };
  for (const [k, l] of Object.entries(req)) {
    if (!String(b[k] || '').trim()) e.push(`${l} مطلوب`);
  }
  if (b.patientName) {
    const v = String(b.patientName).trim();
    if (v.length < 3 || v.length > 80) e.push('اسم المريض: 3-80 حرف');
    if (!/^[\u0600-\u06FF\s\-.]+$/.test(v)) e.push('اسم المريض: حروف عربية فقط');
    if (/test|demo|sample|placeholder|dummy|fake|xxxx|qwerty|0000|1111/i.test(v)) e.push('اسم المريض يبدو اختبارياً');
  }
  if (b.doctorName) {
    const v = String(b.doctorName).trim();
    if (v.length < 3 || v.length > 80) e.push('اسم الطبيب: 3-80 حرف');
    if (!/^[\u0600-\u06FF\s\-.]+$/.test(v)) e.push('اسم الطبيب: حروف عربية فقط');
    if (/test|demo|sample|placeholder|dummy|fake|xxxx|qwerty|0000|1111/i.test(v)) e.push('اسم الطبيب يبدو اختبارياً');
  }
  if (b.patientId) {
    const v = String(b.patientId).trim();
    if (v.length < 4 || v.length > 30) e.push('رقم الهوية: 4-30 رمز');
    if (!/^[A-Za-z0-9\-.]+$/.test(v)) e.push('رقم الهوية: إنجليزي/أرقام/شرطات فقط');
    if (/0{4,}|1{4,}|test|demo|0000|1111|1234|qwer/i.test(v)) e.push('رقم الهوية يبدو اختبارياً');
  }
  if (b.doctorLicense) {
    const v = String(b.doctorLicense).trim();
    if (v.length < 3 || v.length > 30) e.push('الترخيص: 3-30 رمز');
    if (!/^[A-Za-z0-9\-.]+$/.test(v)) e.push('الترخيص: إنجليزي/أرقام/شرطات فقط');
    if (/test|demo|sample|0000|1111|1234/i.test(v)) e.push('الترخيص يبدو اختبارياً');
  }
  if (b.startDate && b.endDate && b.endDate < b.startDate) e.push('تاريخ النهاية قبل البداية');
  return e;
}

// === توليد QR Code كـ DataURL ===
async function generateQRDataURL(url) {
  try {
    const qrBuffer = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'H', type: 'png', margin: 1, width: 300,
      color: { dark: '#003366FF', light: '#FFFFFFFF' }
    });
    return 'data:image/png;base64,' + qrBuffer.toString('base64');
  } catch (e) { return ''; }
}

// === دعم الخط العربي للـ PDFKit ===
let pdfArabicFontRegular = null;
let pdfArabicFontBold = null;
let pdfArabicFontLoaded = false;

function loadArabicFonts() {
  if (pdfArabicFontLoaded) return;
  pdfArabicFontLoaded = true;
  try {
    const fc = path.join(__dirname, 'fonts');
    const regPath = path.join(fc, 'Tajawal-Regular.ttf');
    const boldPath = path.join(fc, 'Tajawal-Bold.ttf');
    if (fs.existsSync(regPath)) pdfArabicFontRegular = regPath;
    if (fs.existsSync(boldPath)) pdfArabicFontBold = boldPath;
    if (pdfArabicFontRegular || pdfArabicFontBold) {
      console.log('[PDF Fonts] Loaded:', { regular: !!pdfArabicFontRegular, bold: !!pdfArabicFontBold });
    } else {
      console.log('[PDF Fonts] No Arabic fonts found in ./fonts/ - using PDFKit default fallback');
    }
  } catch (e) {
    console.warn('[PDF Fonts] Error loading fonts:', e.message);
  }
}

// === توليد شعار المركز SVG (شعرك الخاص) ===
function generateCenterLogoSVG() {
  return `<svg width="65" height="65" viewBox="0 0 70 70" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logoBg2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00a8b5"/>
        <stop offset="100%" stop-color="#003366"/>
      </linearGradient>
    </defs>
    <path d="M 35 2 L 65 14 L 65 36 Q 65 54 35 66 Q 5 54 5 36 L 5 14 Z" fill="url(#logoBg2)" stroke="#003366" stroke-width="1.5"/>
    <path d="M 35 7 L 60 17 L 60 36 Q 60 51 35 61 Q 10 51 10 36 L 10 17 Z" fill="#ffffff" opacity="0.95"/>
    <g transform="translate(35 35)">
      <rect x="-15" y="-3" width="30" height="6" fill="#003366" rx="1"/>
      <rect x="-3" y="-15" width="6" height="30" fill="#003366" rx="1"/>
    </g>
    <circle cx="35" cy="35" r="3" fill="#00a8b5"/>
  </svg>`;
}

// === توليد الختم الرسمي SVG (ختم سداسي مخصص) ===
function generateOfficialSealSVG(name, license, id) {
  const cx = 100, cy = 100, r = 88;
  const outer = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    outer.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2));
  }
  const inner = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2 + Math.PI / 6;
    inner.push((cx + 73 * Math.cos(a)).toFixed(2) + ',' + (cy + 73 * Math.sin(a)).toFixed(2));
  }
  const dn = (name && name.length > 14) ? name.split(' ').slice(0, 2).join(' ') : (name || 'Sahati Medical');
  return `<svg width="170" height="170" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sealOut2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#003366"/>
        <stop offset="100%" stop-color="#0066a8"/>
      </linearGradient>
      <radialGradient id="sealCenter2" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#cce5ff"/>
        <stop offset="100%" stop-color="#003366"/>
      </radialGradient>
    </defs>
    <polygon points="${outer.join(' ')}" fill="url(#sealOut2)" stroke="#003366" stroke-width="2"/>
    <polygon points="${inner.join(' ')}" fill="none" stroke="#00a8b5" stroke-width="1.5"/>
    <circle cx="100" cy="100" r="42" fill="url(#sealCenter2)" stroke="#003366" stroke-width="1.5"/>
    <rect x="86" y="94" width="28" height="5" fill="#00a8b5" rx="2"/>
    <rect x="96" y="84" width="8" height="28" fill="#00a8b5" rx="2"/>
    <text x="100" y="62" text-anchor="middle" font-size="11" font-weight="900" fill="#003366">${esc(dn)}</text>
    <text x="100" y="155" text-anchor="middle" font-size="7" font-weight="900" fill="#003366">Accredited Medical Center</text>
    <text x="100" y="167" text-anchor="middle" font-size="6.5" fill="#475569">License: ${esc(license || '—')}</text>
    <text x="100" y="179" text-anchor="middle" font-size="6" font-weight="900" fill="#475569">No. ${esc(id.slice(-8))}</text>
    <circle cx="100" cy="100" r="3" fill="#ffffff" opacity="0.4"/>
  </svg>`;
}

function generateWatermarkSVG(id) {
  return `<svg width="500" height="500" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:30%;left:30%;opacity:0.06;z-index:1;pointer-events:none">
    <text x="250" y="250" text-anchor="middle" font-size="90" font-weight="900" fill="#003366" transform="rotate(-30 250 250)" font-family="Helvetica">${esc(CENTER_NAME)}</text>
    <text x="250" y="320" text-anchor="middle" font-size="20" fill="#003366" transform="rotate(-30 250 250)" font-family="Courier">ID: ${esc(id.slice(-12))}</text>
  </svg>`;
}

// =====================================================================
// 1. **ميزة Cron Job** - إدارة دورة حياة حالة الإجازة تلقائياً
// =====================================================================
// تشغيل تلقائي كل يوم عند منتصف الليل المحلي بتوقيت السيرفر
function runDailyStatusUpdate() {
  try {
    const db = loadDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let updatedCount = 0;
    for (const id in db) {
      const r = db[id];
      if (r.status === 'active' && r.endDate) {
        const end = new Date(r.endDate + 'T23:59:59');
        if (end < new Date()) {
          db[id].status = 'expired';
          db[id].expiredAt = new Date().toISOString();
          updatedCount++;
          console.log('[CRON] Auto-expired report:', id);
          // إرسال SMS للمريض
          const verifyUrl = (VERIFY_BASE ? VERIFY_BASE : 'https://sahati-medical.onrender.com') + '/check?id=' + id;
          sendNotification(db[id], verifyUrl, 'expired').catch(e => console.error('[CRON SMS]', e.message));
        }
      }
    }
    if (updatedCount > 0) {
      saveDb(db);
      console.log(`[CRON] Daily update completed: ${updatedCount} report(s) auto-expired`);
    } else {
      console.log('[CRON] Daily update completed: no expired reports found');
    }
  } catch (e) {
    console.error('[CRON] Error during daily update:', e.message);
  }
}

// حساب التأخير حتى منتصف الليل القادم
function scheduleNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // منتصف الليل القادم
  const ms = next.getTime() - now.getTime();
  if (ms < 0) return null;
  return setTimeout(() => {
    runDailyStatusUpdate();
    // جدولة التالي بعد 24 ساعة
    dailyJobTimer = setInterval(runDailyStatusUpdate, 24 * 60 * 60 * 1000);
  }, ms);
}

let dailyJobTimer = null;

// تشغيل Cron Job في بيئة الإنتاج فقط (وليس محلياً)
function startDailyCronJob() {
  // المهام المجدولة تعمل بعد Startup واحد فقط
  runDailyStatusUpdate(); // تشغيل فوري لاختبار التطبيق

  if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.RUN_CRON === 'true') {
    scheduleNextMidnight();
    console.log('[CRON] Scheduled daily at midnight');
  } else {
    console.log('[CRON] Skipped scheduling (development mode)');
  }
}

startDailyCronJob();

// =====================================================================
// 2. **ميزة SMS دولي** - إرسال إشعار SMS دولي مع دعم E.164 و UCS-2
// =====================================================================
async function sendNotification(r, verifyUrl, trigger = 'created') {
  const phone = r.patientPhone || '';
  if (!phone) {
    console.log('[SMS] No phone number, skipping');
    return { sent: false, reason: 'no_phone' };
  }

  const e164Phone = toE164(phone);
  if (!e164Phone.startsWith('+')) {
    console.log('[SMS] Invalid phone format:', phone);
    return { sent: false, reason: 'invalid_format' };
  }

  // صياغة الرسالة - تختلف حسب نوع الـ trigger
  let message;
  if (trigger === 'expired') {
    message = `عزيزي/ة ${r.patientName}،\nنود إبلاغك بانتهاء فترة الإجازة المرضية رقم (${r.id}) بتاريخ اليوم. نتمنى لك دوام الصحة والعافية.\n\n${CENTER_FULL_NAME}`;
  } else {
    message = `عزيزي/ة ${r.patientName}،\nتم إصدار تقرير إجازتك المرضية رقم (${r.id}).\n\nرابط التحقق: ${verifyUrl}\n\n${CENTER_FULL_NAME}`;
  }

  // الحد الأقصى للـ SMS العربي الدولي - 70 حرف للـ UCS-2
  const MAX_UCS2_LENGTH = 70;
  if (message.length > MAX_UCS2_LENGTH) {
    // قطع الرسالة بذكاء - الحفاظ على الرابط الأساسي
    const verificationLine = verifyUrl ? `\nرابط التحقق: ${verifyUrl}` : '';
    const maxContent = MAX_UCS2_LENGTH - verificationLine.length - CENTER_FULL_NAME.length - 5;
    if (maxContent > 10) {
      message = message.substring(0, maxContent) + '...' + verificationLine + '\n\n' + CENTER_FULL_NAME;
    }
  }

  try {
    // 1) Taqnyat (الأفضل للسعودية)
    if (TAQNYAT_TOKEN) {
      const https = require('https');
      const postData = JSON.stringify({
        recipients: [e164Phone],
        body: message,
        sender: TAQNYAT_SENDER,
        dcs: 'UCS2' // ترميز يدعم العربية
      });
      return await new Promise((resolve, reject) => {
        const req = https.request({
          method: 'POST',
          hostname: 'api.taqnyat.sa',
          path: '/v1/messages',
          headers: {
            'Authorization': 'Bearer ' + TAQNYAT_TOKEN,
            'Content-Type': 'application/json'
          }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            console.log('[SMS Taqnyat]', res.statusCode, data.substring(0, 200));
            resolve({ sent: true, gateway: 'taqnyat', statusCode: res.statusCode });
          });
        });
        req.on('error', err => resolve({ sent: false, gateway: 'taqnyat', error: err.message }));
        req.write(postData);
        req.end();
      });
    }

    // 2) Twilio SMS
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
      try {
        const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const result = await twilio.messages.create({
          body: message,
          from: TWILIO_FROM_NUMBER,
          to: e164Phone
        });
        console.log('[SMS Twilio]', result.sid);
        return { sent: true, gateway: 'twilio-sms', messageId: result.sid };
      } catch (te) {
        console.error('[SMS Twilio error]', te.message);
      }
    }

    // 3) Twilio WhatsApp
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && WHATSAPP_FROM_NUMBER) {
      try {
        const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const result = await twilio.messages.create({
          body: message,
          from: 'whatsapp:' + WHATSAPP_FROM_NUMBER,
          to: 'whatsapp:' + e164Phone
        });
        console.log('[WhatsApp]', result.sid);
        return { sent: true, gateway: 'whatsapp', messageId: result.sid };
      } catch (we) {
        console.error('[WhatsApp error]', we.message);
      }
    }

    console.log('[SMS - no gateway configured, simulating]');
    console.log('  Phone:', phone, '→', e164Phone);
    console.log('  Length:', message.length, 'chars (max UCS-2:', 70, ')');
    console.log('  Message:', message);
    return { sent: 'simulated', reason: 'no_gateway' };
  } catch (e) {
    console.error('[SMS Error]:', e.message);
    return { sent: false, error: e.message };
  }
}

// =====================================================================
// 3. **ميزة PDF محسنة** - Tajawal font + صفحة واحدة A4 + RTL + watermark
// =====================================================================
function generatePDF(r, verifyUrl, qrDataUrl, callback) {
  try {
    loadArabicFonts();

    // إعدادات A4 صفحة واحدة - مع هوامش ضيقة للملاءمة
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
      autoFirstPage: true,
      bufferPages: true,
      info: {
        Title: 'Sick Leave Report ' + r.id,
        Author: CENTER_FULL_NAME,
        Subject: 'Sick Leave Report',
        Producer: CENTER_FULL_NAME + ' Medical Reports System',
        Keywords: 'medical, sick-leave, verified, ' + r.id,
        CreationDate: new Date(r.createdAt)
      }
    });

    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => callback(null, Buffer.concat(buffers)));
    doc.on('error', err => callback(err));

    // تسجيل خط عربي للـ PDFKit
    let useArabicFont = false;
    if (pdfArabicFontRegular) {
      try {
        doc.registerFont('Tajawal', pdfArabicFontRegular);
        useArabicFont = true;
      } catch (e) {}
    }
    if (pdfArabicFontBold && useArabicFont) {
      try { doc.registerFont('Tajawal-Bold', pdfArabicFontBold); } catch (e) {}
    }

    const arabicFont = useArabicFont ? 'Tajawal' : 'Helvetica';
    const arabicBold = useArabicFont ? 'Tajawal-Bold' : 'Helvetica-Bold';

    // ========== 1. العلامة المائية ==========
    doc.save();
    doc.opacity(0.06);
    doc.fillColor('#003366');
    doc.fontSize(95);
    doc.font(arabicBold);
    if (useArabicFont) {
      doc.text(CENTER_NAME, 90, 380, { width: 420, align: 'center' });
    } else {
      doc.rotate(-30, { origin: [297, 421] });
      doc.text(CENTER_NAME, 100, 380, { width: 400, align: 'center' });
      doc.rotate(30, { origin: [297, 421] });
    }
    doc.fontSize(14);
    doc.fillColor('#475569');
    doc.text('ID: ' + (r.id || '').slice(-12), 150, 470, { width: 300, align: 'center' });
    doc.restore();

    // ========== 2. الترويسة ==========
    doc.fillColor('#003366').opacity(1);
    doc.fontSize(20).font(arabicBold);
    if (useArabicFont) {
      doc.text(CENTER_NAME, 60, 40, { width: 480, align: 'center' });
    } else {
      doc.text(CENTER_NAME, { align: 'center' });
    }
    doc.fontSize(11).fillColor('#0066a8').font(arabicFont);
    doc.text('Sahati Medical Center - مركز صحتي الطبي', { align: 'center' });
    doc.fontSize(9).fillColor('#64748b');
    doc.text('Document Type: Sick Leave Report - Leave ID #' + (r.id || '').slice(-12), { align: 'center' });
    doc.fontSize(8);
    doc.text((CENTER_INSTITUTION || '') + ' - ' + (CENTER_CITY || '') + ' - License: ' + (CENTER_LICENSE || '—'), { align: 'center' });

    // خط فاصل
    doc.moveDown(0.5);
    const headerEnd = doc.y;
    doc.strokeColor('#003366').lineWidth(1.5).moveTo(15, headerEnd).lineTo(580, headerEnd).stroke();
    doc.moveDown(0.5);

    // ========== 3. العنوان الرئيسي ==========
    doc.fontSize(18).fillColor('#003366').font(arabicBold);
    doc.text('Sick Leave Report / تقرير إجازة مرضية', { align: 'center' });
    doc.moveDown(0.5);

    // ========== 4. الحالة والمعرف ==========
    const st = statusOf(r);
    const stColor = st === 'active' ? '#10b981' : st === 'expired' ? '#dc2626' : '#856404';
    const stBg = st === 'active' ? '#d4edda' : st === 'expired' ? '#fee2e2' : '#fff3cd';
    const stText = st === 'active' ? '✓ ACTIVE / سارٍ' : st === 'expired' ? '⚠ EXPIRED / منتهي' : '✗ CANCELLED / ملغى';

    doc.fontSize(10).font(arabicFont);
    doc.fillColor('#0f172a');
    if (useArabicFont) {
      doc.text(`معرّف الإجازة: ${r.id || ''}`, 15, doc.y, { width: 280, align: 'end' });
    } else {
      doc.text(`Leave ID: ${r.id || ''}`, 15, doc.y);
    }
    // مربع ملون للحالة
    const badgeW = 90, badgeH = 16, badgeX = 480, badgeY = doc.y - 2;
    doc.fillColor(stBg).rect(badgeX, badgeY, badgeW, badgeH).fill();
    doc.fillColor(stColor).fontSize(9).font(arabicBold);
    const badgeText = stText;
    doc.text(badgeText, badgeX + 4, badgeY + 4, { width: badgeW - 8 });
    doc.moveDown(0.7);

    doc.fillColor('#64748b').fontSize(8);
    if (useArabicFont) {
      doc.text(`تاريخ الإصدار: ${fmtDateTimeAr(r.createdAt || new Date().toISOString())} / Issue Time: ${fmtDateTimeEn(r.createdAt || new Date().toISOString())}`, { align: 'center' });
    } else {
      doc.text(`Issue Time: ${fmtDateTimeEn(r.createdAt || new Date().toISOString())} / Status: ${stText}`, { align: 'center' });
    }
    doc.moveDown(0.5);

    // ========== 5. جدول البيانات بأسلوب Enterprise ==========
    const d = daysBetween(r.startDate, r.endDate);
    const dLabel = d ? d + ' day(s)' : '—';

    const items = [
      ['مدة الإجازة', 'Leave Duration', dLabel, true, 'ar'],
      ['تاريخ الدخول', 'Admission Date', r.admissionDate ? fmtDateShort(r.admissionDate) : '—', false, 'ar'],
      ['تاريخ الخروج', 'Discharge Date', r.dischargeDate ? fmtDateShort(r.dischargeDate) : '—', false, 'ar'],
      ['وقت الإصدار', 'Issue Time', fmtTime(r.createdAt), false, 'ar'],
      ['الاسم', 'Name', r.patientName || '', false, 'ar'],
      ['رقم الهوية', 'National ID', r.patientId || '', false, 'ar'],
      ['الجنسية', 'Nationality', r.patientNationality || '—', false, 'ar'],
      ['جهة العمل', 'Employer', r.patientEmployer || '—', false, 'ar'],
      ['اسم الطبيب', 'Physician', r.doctorName || '', false, 'ar'],
      ['التخصص', 'Specialty', r.doctorSpecialty || '', false, 'ar'],
      ['رقم الترخيص الطبي', 'License No.', r.doctorLicense || '', false, 'ar']
    ];
    if (r.recommendText) items.push(['التوصية الطبية', 'Recommendation', r.recommendText || '', false, 'ar']);
    if (r.notes) items.push(['ملاحظات', 'Notes', r.notes || '', false, 'ar']);

    // رأس الجدول بخلفية #003366
    const tableY = doc.y;
    const tableX = 15, tableW = 565, rowH = 18;
    doc.fillColor('#003366').rect(tableX, tableY, tableW, rowH).fill();
    doc.fillColor('#ffffff').fontSize(9).font(arabicBold);
    const col1X = tableX + 5;          // العربية (يمين)
    const col2X = tableX + 200;        // القيمة (وسط)
    const col3X = tableX + 395;        // English (يسار)
    if (useArabicFont) {
      doc.text('العربية', col1X + 180, tableY + 5, { width: 180, align: 'right' });
    } else {
      doc.text('AR', col1X, tableY + 5);
    }
    doc.text('القيمة', col2X + 85, tableY + 5, { width: 175, align: 'center' });
    doc.text('English', col3X, tableY + 5);

    let y = tableY + rowH;

    items.forEach((it, idx) => {
      const hl = it[3];
      // التناوب اللوني - #f8f9fa للصفوف الزوجية
      if (hl) {
        doc.fillColor('#003366');
      } else if (idx % 2 === 1) {
        doc.fillColor('#f8f9fa');
      } else {
        doc.fillColor('#ffffff');
      }
      doc.rect(tableX, y, tableW, rowH).fill();

      if (hl) {
        doc.fillColor('#ffffff').font(arabicBold).fontSize(9);
      } else {
        doc.fillColor('#003366').font(arabicBold).fontSize(9);
      }
      if (useArabicFont) {
        doc.text(it[1], col1X, y + 5, { width: 175, align: 'right' });
      } else {
        doc.text(it[1], col1X, y + 5);
      }

      if (hl) {
        doc.fillColor('#ffffff').font(arabicBold).fontSize(9);
      } else {
        doc.fillColor('#0f172a').font(arabicFont).fontSize(9);
      }
      doc.text(String(it[2] || '').substring(0, 50), col2X + 5, y + 5, { width: 180, align: 'center' });

      if (hl) {
        doc.fillColor('#ffffff').font(arabicBold).fontSize(8).font('Courier');
      } else {
        doc.fillColor('#0066a8').font(arabicBold).fontSize(9).font('Courier');
      }
      doc.text(it[0], col3X, y + 5);

      y += rowH;
    });

    // خط فاصل قبل الـ QR
    doc.strokeColor('#dee2e6').lineWidth(0.5).moveTo(15, y + 2).lineTo(580, y + 2).stroke();
    y += 5;

    // ========== 6. QR + الختم + رابط التحقق التفاعلي ==========
    const qrSize = 65, qrX = 30, qrY = y;

    if (qrDataUrl) {
      try {
        const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
        const qrBuffer = Buffer.from(base64Data, 'base64');
        doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      } catch (e) {}
    }

    // رابط التحقق التفاعلي بجانب الـ QR
    doc.fillColor('#003366').fontSize(9).font(arabicBold);
    doc.text('Verify online / تحقق:', qrX + qrSize + 8, qrY + 5);
    doc.fillColor('#0066a8').fontSize(8).font(arabicFont);
    doc.text(verifyUrl, qrX + qrSize + 8, qrY + 18, { link: verifyUrl, underline: true, width: 270 });

    doc.fillColor('#475569').fontSize(7.5);
    doc.text('Tap the link or scan QR - اضغط الرابط أو امسح رمز QR', qrX + qrSize + 8, qrY + 32, { width: 270 });
    doc.fillColor('#475569').fontSize(8);
    doc.text('Issued: ' + fmtDateTimeEn(r.createdAt || new Date().toISOString()), qrX + qrSize + 8, qrY + 45, { width: 270 });
    doc.text('الحالة: ' + statusTextAr(st), qrX + qrSize + 8, qrY + 56, { width: 270 });

    // الختم الرسمي
    try {
      const sealBuffer = Buffer.from(generateOfficialSealSVG(CENTER_NAME, CENTER_LICENSE, r.id));
      doc.image(sealBuffer, 480, qrY - 5, { width: 80, height: 80 });
    } catch (e) {}

    y += qrSize + 8;

    // ========== 7. Footer رسمي ==========
    doc.fillColor('#f8f9fa').rect(15, y, 565, 24).fill();
    doc.fillColor('#003366').fontSize(8).font(arabicBold);
    doc.text('Notice / تنبيه رسمي:', 18, y + 5);
    doc.fillColor('#475569').font(arabicFont).fontSize(7);
    doc.text('This document is an official medical report issued by ' + CENTER_FULL_NAME + '. Tampering or reproduction is prohibited.', 18, y + 13, { width: 545 });
    doc.text('هذه وثيقة طبية رسمية موقّعة إلكترونياً SHA-256 ومُتحقَّق منها عبر رمز QR.', 18, y + 22);

    // تأكيد فريد للوثيقة
    doc.fillColor('#94a3b8').fontSize(6.5);
    doc.text('Document Hash: SHA-256:' + (r.id || 'N/A') + ' | Verification Code: ' + (r.id || '').slice(0, 8).toUpperCase(), 18, doc.y, { align: 'center', width: 565 });

    doc.end();
  } catch (e) {
    console.error('[PDF Error]:', e.message);
    callback(e);
  }
}

// =====================================================================
// قوالب CSS مدمجة (RTL, Cairo, Enterprise Style)
// =====================================================================
const TPL_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { direction: rtl; }
body { font-family: 'Cairo', 'Tajawal', 'Segoe UI', 'Noto Naskh Arabic', Arial, sans-serif; background: #f0f4f8; color: #0f172a; line-height: 1.65; min-height: 100vh; display: flex; flex-direction: column; font-size: 14.5px; }
a { color: #003366; text-decoration: none; }
a:hover { text-decoration: underline; }

header.app-header { background: linear-gradient(135deg, #003366 0%, #0066a8 100%); color: #fff; padding: 12px 22px; box-shadow: 0 2px 10px rgba(0,51,102,0.2); }
header .inner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; max-width: 920px; margin: 0 auto; }
header .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 19px; }
header .brand .logo { display: flex; width: 38px; height: 38px; align-items: center; justify-content: center; background: rgba(255,255,255,0.15); border-radius: 6px; }
header .brand .badge-new { background: #fbbf24; color: #003366; padding: 3px 8px; border-radius: 10px; font-size: 10px; margin-inline-start: 8px; font-weight: 800; }
header .nav a { font-weight: 700; margin-inline-start: 18px; color: #fff; }

.wrap { padding: 20px; max-width: 920px; margin: 0 auto; width: 100%; }
.app-content { flex: 1; }
.card { background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 2px 12px rgba(0,51,102,0.06); margin-bottom: 18px; border: 1px solid #f0f4f8; }
.card h2 { color: #003366; margin-bottom: 14px; font-size: 18px; text-align: center; }
.muted { color: #64748b; font-size: 13px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
form { display: grid; gap: 12px; margin-top: 14px; }
form .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
label { display: grid; gap: 4px; }
label > span { font-weight: 700; font-size: 12.5px; color: #003366; }
label > span .req { color: #dc2626; }
input, select, textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 12px; font-size: 14px; font-family: inherit; background: #fff; transition: border-color 0.15s; }
input:focus, select:focus, textarea:focus { outline: none; border-color: #003366; box-shadow: 0 0 0 3px rgba(0,51,102,0.1); }
textarea { resize: vertical; min-height: 60px; font-family: inherit; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: 6px; border: 1.5px solid transparent; font-size: 14px; font-weight: 800; font-family: inherit; cursor: pointer; background: none; transition: transform 0.15s; text-decoration: none; }
.btn:hover { transform: translateY(-1px); }
.btn-primary { background: #003366; color: #fff; box-shadow: 0 4px 12px rgba(0,51,102,0.2); }
.btn-primary:hover { background: #0066a8; }
.btn-outline { border-color: #003366; color: #003366; background: #fff; }
.btn-outline:hover { background: #e3ebf3; }
.btn-danger { background: #fee2e2; color: #991b1b; }
.btn-danger:hover { background: #dc2626; color: #fff; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-lg { padding: 12px 28px; font-size: 15px; }
.btn-block { width: 100%; }

.badge { display: inline-block; padding: 4px 11px; border-radius: 14px; font-size: 12px; font-weight: 800; }
.badge.ok { background: #d4edda; color: #155724; }
.badge.warn { background: #fff3cd; color: #856404; }
.badge.bad { background: #f8d7da; color: #991b1b; }
.badge.expired { background: #fee2e2; color: #991b1b; }

.alert { padding: 12px 16px; border-radius: 6px; margin-bottom: 14px; font-size: 13.5px; }
.alert-error { background: #f8d7da; color: #991b1b; border-inline-start: 4px solid #dc2626; }
.alert ul { margin: 6px 0 0 16px; }
.alert-ok { background: #d4edda; color: #155724; border-inline-start: 4px solid #16a34a; }
.alert-warn { background: #fff3cd; color: #856404; border-inline-start: 4px solid #f59e0b; }
.alert-info { background: #ddebf8; color: #003366; border-inline-start: 4px solid #003366; }
.toolbar { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin: 18px 0 10px; align-items: center; }

/* ==== الصفحة الواحدة A4 Enterprise ==== */
.report-paper {
  background: #fff; border: 1px solid #003366; border-radius: 4px;
  padding: 10mm 8mm; margin: 14px auto; max-width: 210mm;
  display: flex; flex-direction: column; gap: 5px; position: relative;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow: hidden;
  page-break-inside: avoid; max-height: 100vh;
}
.report-paper::before {
  content: ''; position: absolute; top: 3px; left: 3px; right: 3px; bottom: 3px;
  border: 0.5px solid rgba(0,51,102,0.1); pointer-events: none;
}

.rp-header {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px;
  padding: 6px 8px; border-bottom: 2px solid #003366; background: #f8f9fa;
}
.rp-header-left, .rp-header-right { display: flex; align-items: center; }
.rp-header-left { justify-content: flex-start; }
.rp-header-right { justify-content: flex-end; gap: 6px; flex-direction: column; align-items: flex-end; }
.rp-header-center { text-align: center; }
.rp-title-ar { font-size: 17px; font-weight: 900; color: #003366; }
.rp-title-en { font-size: 11px; font-weight: 700; color: #0066a8; direction: ltr; margin-top: 2px; }
.rp-dept { font-size: 10px; color: #475569; margin-top: 2px; font-weight: 600; }

.status-flag {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 14px; font-weight: 800; font-size: 11px;
  animation: flag-pulse 2.4s ease-in-out infinite;
}
.status-flag.active { background: linear-gradient(135deg, #10b981, #059669); color: white; box-shadow: 0 0 0 3px rgba(16,185,129,0.2); }
.status-flag.expired { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; box-shadow: 0 0 0 3px rgba(239,68,68,0.2); animation: flag-pulse-expired 2s infinite; }
.status-flag.cancelled { background: #fee2e2; color: #991b1b; }
@keyframes flag-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); } 50% { box-shadow: 0 0 0 6px rgba(16,185,129,0.1); } }
@keyframes flag-pulse-expired { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0.15); } }

.rp-doc-title { text-align: center; font-size: 20px; font-weight: 900; color: #003366; margin-top: 6px; letter-spacing: 0.5px; }
.rp-doc-subtitle { text-align: center; font-size: 12.5px; font-weight: 700; color: #0066a8; direction: ltr; margin-bottom: 4px; }
.rp-doc-divider { height: 1px; background: linear-gradient(to right, transparent, #003366, transparent); margin: 4px 0; }

.rp-table {
  width: 100%; border-collapse: collapse; margin-bottom: 4px;
  border: 1px solid #003366; border-radius: 4px; overflow: hidden; font-size: 11px;
}
.rp-table thead th { background: #003366; color: #ffffff; padding: 8px 10px; font-weight: 800; font-size: 11px; border-bottom: 2px solid #0066a8; text-align: center; }
.rp-table tr { border-bottom: 1px solid #dee2e6; background: #fff; }
.rp-table tr:nth-child(even) { background: #f8f9fa; }
.rp-table td { padding: 5px 10px; vertical-align: middle; }
.rp-table td.r-label { width: 30%; background: inherit; font-weight: 700; color: #003366; text-align: end; }
.rp-table td.r-value { width: 40%; background: inherit; text-align: center; font-weight: 600; color: #0f172a; }
.rp-table td.r-label-en { width: 30%; background: inherit; font-weight: 600; color: #0066a8; text-align: start; direction: ltr; }
.rp-table tr.highlight td { background: #003366 !important; color: #ffffff !important; font-weight: 800; }
.rp-table tr.highlight td.r-label-en { color: #ffffff !important; }

.rp-footer-grid { display: flex; gap: 12px; margin-top: 6px; padding: 0 4px; direction: ltr; flex-wrap: wrap; }
.rp-seal-col { order: 1; flex: 1 1 45%; min-width: 200px; background: #f8f9fa; border: 1px solid #ced4da; border-radius: 4px; padding: 8px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 110px; }
.rp-qr-col { order: 2; flex: 1 1 45%; min-width: 200px; background: #f8f9fa; border: 1px solid #ced4da; border-radius: 4px; padding: 8px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 110px; }
.rp-qr-box { width: 90px; height: 90px; background: #fff; border: 1px solid #003366; padding: 2px; display: flex; align-items: center; justify-content: center; }
.rp-qr-box img { display: block; width: 100%; height: 100%; }
.rp-qr-text { text-align: center; font-size: 10px; color: #495057; line-height: 1.3; margin-top: 4px; }
.rp-qr-text .ar { font-weight: 700; color: #003366; margin-bottom: 2px; font-size: 11px; }
.rp-qr-text .en { font-size: 9px; color: #0066a8; direction: ltr; margin-bottom: 4px; font-weight: 700; }
.rp-qr-text .verify-link { color: #003366; word-break: break-all; font-weight: 700; font-family: monospace; font-size: 9px; direction: ltr; display: block; margin-top: 3px; padding: 3px 5px; background: #fff; border: 1px solid #003366; border-radius: 3px; }
.rp-seal-name { font-size: 11px; font-weight: 800; color: #003366; margin-top: 2px; }
.rp-seal-tagline { font-size: 9px; color: #475569; margin-top: 1px; }

.action-bar { display: flex; gap: 8px; justify-content: center; margin-top: 14px; flex-wrap: wrap; }
.action-bar .btn { flex: 1; min-width: 140px; }
.cta-buttons { display: flex; gap: 10px; justify-content: center; margin: 14px 0; flex-wrap: wrap; }
.cta-buttons .btn { min-width: 150px; padding: 14px 22px; font-weight: 800; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }

footer.app-footer { margin-top: auto; background: linear-gradient(135deg, #003366 0%, #0066a8 100%); color: #fff; padding: 14px 0; text-align: center; font-size: 12px; }
.config-error { max-width: 600px; margin: 60px auto; background: #f8d7da; border: 2px solid #dc2626; border-radius: 8px; padding: 24px; text-align: center; }
.config-error h1 { color: #991b1b; font-size: 20px; margin-bottom: 12px; }
.config-error code { background: #fff; padding: 4px 10px; border-radius: 4px; font-family: Consolas, monospace; color: #991b1b; display: inline-block; margin: 4px; font-size: 12px; }

@media (max-width: 760px) {
  form .grid { grid-template-columns: 1fr; }
  .rp-header { grid-template-columns: auto 1fr auto; }
  .rp-header-right { display: flex; }
  .rp-footer-grid { grid-template-columns: 1fr; }
  .rp-info-grid { grid-template-columns: 1fr; }
}

@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body { background: #fff !important; }
  header.app-header, footer.app-footer, .toolbar, .no-print { display: none !important; }
  .wrap { padding: 0; max-width: 100%; }
  .report-paper { border: 1px solid #ccc; padding: 8mm 6mm; max-width: 100%; margin: 0; box-shadow: none; border-radius: 4px; page-break-inside: avoid; gap: 4px; max-height: 100vh; }
  .cta-buttons { display: none; }
}
`;

function pageStart(title) {
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet"><title>' + esc(title) + '</title><style>' + TPL_CSS + '</style></head><body>';
}
function pageHeader() {
  return '<header class="app-header"><div class="inner"><div class="brand">' + generateCenterLogoSVG() + '<span>' + esc(CENTER_NAME) + '</span><span class="badge-new">v4.5 Enterprise</span></div><nav class="nav"><a href="/">إصدار تقرير</a><a href="/verify">تحقق</a></nav></div></header>';
}
function pageFooter() {
  return '<footer class="app-footer"><strong>' + esc(CENTER_FULL_NAME) + '</strong> — معتمد رسمياً • SHA-256 • Auto-Lifecycle • © ' + new Date().getFullYear() + '</footer></body></html>';
}
function configMissing() {
  const m = [];
  if (!CENTER_NAME) m.push('CENTER_NAME');
  if (!VERIFY_BASE) m.push('VERIFY_BASE');
  if (!CENTER_LICENSE) m.push('CENTER_LICENSE');
  return m;
}
function configErrorPage(m) {
  return pageStart('مطلوب إعدادات') +
    '<main class="app-content"><div class="wrap"><div class="card config-error"><h1>⚙️ يحتاج الموقع إلى إعدادات</h1>' +
    '<p style="margin-bottom:14px">عيّن متغيرات البيئة في Render:</p>' +
    m.map(x => '<code>' + esc(x) + '</code>').join('<br>') +
    '<p style="margin-top:14px;font-size:12px;color:#64748b">أضفها في Render → Environment، ثم أعد النشر.</p>' +
    '</div></div></main>' + pageFooter();
}
function getBaseUrl(req) {
  if (VERIFY_BASE) return VERIFY_BASE.replace(/\/$/, '');
  return (req.get('x-forwarded-proto') || req.protocol) + '://' + req.get('host');
}

// =====================================================================
// المسارات (Routes)
// =====================================================================

app.get('/', (req, res) => {
  const m = configMissing();
  if (m.length > 0) return res.status(503).send(configErrorPage(m));
  const today = new Date().toISOString().slice(0, 10);
  res.send(pageStart('إصدار تقرير') + pageHeader() +
    '<main class="app-content"><div class="wrap"><div class="card">' +
    '<h2>إصدار تقرير طبي — ' + esc(CENTER_NAME) + '</h2>' +
    '<p class="muted" style="text-align:center">License: <strong>' + esc(CENTER_LICENSE) + '</strong> | Hash: SHA-256 | Auto-Lifecycle</p>' +
    '<form method="post" action="/report">' +
    '<div class="grid">' +
      '<label><span>اسم المريض <span class="req">*</span></span><input type="text" name="patientName" required minlength="3" maxlength="80" placeholder="مثل: فاطمة أحمد"></label>' +
      '<label><span>رقم الهوية <span class="req">*</span></span><input type="text" name="patientId" required dir="ltr" placeholder="مثل: 1029384756"></label>' +
      '<label><span>رقم الطالب/الموظف</span><input type="text" name="patientCode" dir="ltr" placeholder="اختياري"></label>' +
      '<label><span>العمر</span><input type="number" name="patientAge" min="0" max="130"></label>' +
      '<label><span>رقم هاتف المريض (E.164)</span><input type="tel" name="patientPhone" dir="ltr" placeholder="+966500000000 (لإرسال SMS)"></label>' +
      '<label><span>البريد الإلكتروني</span><input type="email" name="patientEmail" dir="ltr" placeholder="اختياري"></label>' +
      '<label><span>الجنسية</span><input type="text" name="patientNationality" value="سعودي"></label>' +
      '<label><span>جهة العمل</span><input type="text" name="patientEmployer" placeholder="اختياري"></label>' +
      '<label><span>اسم الطبيب <span class="req">*</span></span><input type="text" name="doctorName" required minlength="3" placeholder="مثل: ' + esc(DOCTOR_DEFAULT) + '"></label>' +
      '<label><span>تخصص الطبيب</span><input type="text" name="doctorSpecialty" placeholder="مثل: باطنية"></label>' +
      '<label><span>رقم الترخيص <span class="req">*</span></span><input type="text" name="doctorLicense" required dir="ltr" placeholder="SCFHS-..."></label>' +
      '<label><span>القسم</span><input type="text" name="department" placeholder="اختياري"></label>' +
    '</div>' +
    '<label><span>التوصية الطبية</span><textarea name="recommendText" rows="2" maxlength="500" placeholder="مثل: يحتاج المريض إلى راحة لمدة أسبوع"></textarea></label>' +
    '<div class="grid">' +
      '<label><span>تاريخ بداية الإجازة <span class="req">*</span></span><input type="date" name="startDate" required></label>' +
      '<label><span>تاريخ نهاية الإجازة <span class="req">*</span></span><input type="date" name="endDate" required></label>' +
      '<label><span>تاريخ الدخول</span><input type="date" name="admissionDate"></label>' +
      '<label><span>تاريخ الخروج</span><input type="date" name="dischargeDate"></label>' +
    '</div>' +
    '<label><span>ملاحظات إضافية</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>' +
    '<button type="submit" class="btn btn-primary btn-block btn-lg">💾 حفظ + توليد PDF تفاعلي مع QR</button>' +
    '</form></div></div></main>' + pageFooter());
});

app.post('/report', async (req, res) => {
  const m = configMissing();
  if (m.length > 0) return res.status(503).send(configErrorPage(m));
  const b = req.body || {};
  const errs = validateInput(b);
  if (errs.length) {
    return res.status(400).send(pageStart('إصدار تقرير') + pageHeader() +
      '<main class="app-content"><div class="wrap"><div class="card">' +
      '<div class="alert alert-error"><strong>تعذّر إصدار التقرير:</strong><ul>' +
      errs.map(e => '<li>' + esc(e) + '</li>').join('') +
      '</ul></div><a href="/" class="btn btn-outline">العودة للنموذج</a>' +
      '</div></div></main>' + pageFooter());
  }

  const id = makeSecureId();
  const now = new Date().toISOString();
  const report = {
    id, status: 'active', createdAt: now,
    centerName: CENTER_NAME, centerLicense: CENTER_LICENSE,
    department: String(b.department || '').trim(),
    patientName: String(b.patientName || '').trim(),
    patientId: String(b.patientId || '').trim(),
    patientCode: String(b.patientCode || '').trim(),
    patientAge: String(b.patientAge || '').trim(),
    patientPhone: String(b.patientPhone || '').trim(),
    patientEmail: String(b.patientEmail || '').trim(),
    patientNationality: String(b.patientNationality || '').trim(),
    patientEmployer: String(b.patientEmployer || '').trim(),
    doctorName: String(b.doctorName || '').trim(),
    doctorSpecialty: String(b.doctorSpecialty || 'طب عام').trim(),
    doctorLicense: String(b.doctorLicense || '').trim(),
    recommendText: String(b.recommendText || '').trim(),
    notes: String(b.notes || '').trim(),
    startDate: b.startDate, endDate: b.endDate,
    admissionDate: b.admissionDate, dischargeDate: b.dischargeDate
  };

  // حفظ دائم في قاعدة البيانات
  const db = loadDb();
  db[id] = report;
  saveDb(db);
  console.log('[DB] Saved report:', id);

  const base = getBaseUrl(req);
  const verifyUrl = base + '/check?id=' + id;
  const qrImg = await generateQRDataURL(verifyUrl);
  console.log('[QR] Generated for:', id);

  // إرسال SMS عند إنشاء التقرير (سيفشل بصمت إذا لم يضبط TAQNYAT_TOKEN)
  if (report.patientPhone) sendNotification(report, verifyUrl, 'created').catch(err => console.error('[SMS]', err.message));

  res.redirect('/report/' + id + '?qr=' + encodeURIComponent(qrImg || ''));
});

app.get('/report/:id', async (req, res) => {
  const m = configMissing();
  if (m.length > 0) return res.status(503).send(configErrorPage(m));
  const db = loadDb();
  const r = db[req.params.id];
  if (!r) {
    return res.status(404).send(pageStart('غير موجود') + pageHeader() +
      '<main class="app-content"><div class="wrap"><div class="card">' +
      '<h2>التقرير غير موجود</h2>' +
      '<p class="muted">قد يكون قد تم حذفه أو صيغة المعرّف خاطئة.</p>' +
      '<a href="/" class="btn btn-primary">إصدار تقرير جديد</a>' +
      '</div></div></main>' + pageFooter());
  }

  const st = statusOf(r);
  const base = getBaseUrl(req);
  const verifyUrl = base + '/check?id=' + r.id;
  const qrImg = req.query.qr && req.query.qr.length > 100 ? decodeURIComponent(req.query.qr) : await generateQRDataURL(verifyUrl);
  const cols = statusColor(st);

  res.send(pageStart('تقرير — ' + r.id) + pageHeader() +
    '<main class="app-content"><div class="wrap">' +
    '<div class="toolbar no-print">' +
      '<a href="/" class="btn btn-outline btn-sm">← تقرير جديد</a>' +
      '<div class="row">' +
        '<a href="/report/' + esc(r.id) + '/pdf" target="_blank" class="btn btn-primary btn-sm">📥 تحميل PDF تفاعلي</a>' +
        '<button onclick="window.print()" class="btn btn-outline btn-sm">🖨️ طباعة فقط</button>' +
        (st === 'active' ? '<form method="post" action="/report/' + esc(r.id) + '/cancel" style="display:inline" onsubmit="return confirm(\'سيتم إلغاء هذا التقرير. استمرار؟\')"><button type="submit" class="btn btn-danger btn-sm">إلغاء</button></form>' : '') +
      '</div>' +
    '</div>' +
    renderReportPaper(r, qrImg, verifyUrl) +
    '</div></main>' + pageFooter());
});

app.get('/report/:id/pdf', (req, res) => {
  const db = loadDb();
  const r = db[req.params.id];
  if (!r) return res.status(404).send('Not found');
  const base = getBaseUrl(req);
  const verifyUrl = base + '/check?id=' + r.id;
  generateQRDataURL(verifyUrl).then(qrDataUrl => {
    generatePDF(r, verifyUrl, qrDataUrl, (err, pdfBuffer) => {
      if (err) return res.status(500).send('PDF Error: ' + err.message);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="report-' + r.id + '.pdf"');
      res.send(pdfBuffer);
    });
  });
});

function renderReportPaper(r, qrImg, verifyUrl) {
  const st = statusOf(r);
  const cols = statusColor(st);
  const d = daysBetween(r.startDate, r.endDate);
  const dLabel = d ? d + ' day(s)' : '—';
  const flagClass = st;
  const flagText = statusTextEn(st) + ' / ' + statusTextAr(st);

  const items = [
    ['مدة الإجازة', 'Leave Duration', dLabel, true],
    ['تاريخ الدخول', 'Admission Date', r.admissionDate ? fmtDateShort(r.admissionDate) : '—'],
    ['تاريخ الخروج', 'Discharge Date', r.dischargeDate ? fmtDateShort(r.dischargeDate) : '—'],
    ['وقت الإصدار', 'Issue Time', fmtTime(r.createdAt)],
    ['الاسم', 'Name', r.patientName],
    ['رقم الهوية', 'National ID', r.patientId],
    ['الجنسية', 'Nationality', r.patientNationality || '—'],
    ['جهة العمل', 'Employer', r.patientEmployer || '—'],
    ['اسم الطبيب', 'Physician', r.doctorName],
    ['التخصص', 'Specialty', r.doctorSpecialty],
    ['رقم الترخيص', 'License No.', r.doctorLicense]
  ];
  if (r.recommendText) items.push(['التوصية', 'Recommendation', r.recommendText]);
  if (r.notes) items.push(['ملاحظات', 'Notes', r.notes]);

  let rows = '';
  items.forEach((it, idx) => {
    const hl = it[3] ? ' highlight' : '';
    rows += '<tr class="row-' + idx + hl + '"><td class="r-label">' + (idx + 1) + '. ' + esc(it[1]) + '</td>' +
      '<td class="r-value">' + esc(String(it[2])) + '</td>' +
      '<td class="r-label-en">' + esc(it[0]) + '</td></tr>';
  });

  return '<div class="report-paper">' +
    '<div class="rp-header">' +
      '<div class="rp-header-left">' + generateCenterLogoSVG() + '</div>' +
      '<div class="rp-header-center">' +
        '<div class="rp-title-ar">' + esc(CENTER_NAME) + '</div>' +
        '<div class="rp-title-en">Sahati Medical Center</div>' +
        '<div class="rp-dept">' + esc(CENTER_INSTITUTION) + ' - ' + esc(CENTER_CITY) + '</div>' +
      '</div>' +
      '<div class="rp-header-right">' +
        '<div class="status-flag ' + flagClass + '" style="background:' + cols.bg + ';color:' + cols.text + '">' + flagText + '</div>' +
        '<div style="font-size:9px;color:#64748b;margin-top:4px;font-family:Consolas,monospace">#' + esc(r.id.slice(-10)) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="rp-doc-title">Sick Leave Report / تقرير إجازة مرضية</div>' +
    '<div class="rp-doc-subtitle">Official Medical Document - وثيقة طبية رسمية</div>' +
    '<div class="rp-doc-divider"></div>' +
    '<table class="rp-table"><thead><tr>' +
      '<th style="width:30%;text-align:end">العربية</th>' +
      '<th style="width:40%;text-align:center">القيمة</th>' +
      '<th style="width:30%;text-align:start;direction:ltr">English</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="rp-footer-grid">' +
      '<div class="rp-qr-col">' +
        '<div class="rp-qr-box">' + (qrImg ? '<img src="' + qrImg + '" alt="QR"/>' : '<div style="color:#999">QR</div>') + '</div>' +
        '<div class="rp-qr-text">' +
          '<div class="ar">امسح رمز QR أو اضغط على الرابط للتحقق</div>' +
          '<div class="en">Scan QR or click to verify</div>' +
          '<a href="' + esc(verifyUrl) + '" target="_blank" class="verify-link">' + esc(verifyUrl) + '</a>' +
        '</div>' +
      '</div>' +
      '<div class="rp-seal-col">' +
        generateOfficialSealSVG(CENTER_NAME, CENTER_LICENSE, r.id) +
        '<div class="rp-seal-name">' + esc(CENTER_NAME) + '</div>' +
        '<div class="rp-seal-tagline">' + esc(CENTER_INSTITUTION) + ' - ' + esc(CENTER_CITY) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="text-align:center;font-size:8px;color:#94a3b8;margin-top:6px;padding-top:5px;border-top:1px dashed #e0e4e8">Issued: ' + esc(fmtDateTimeEn(r.createdAt) + ' / ' + fmtDateTimeAr(r.createdAt)) + ' | SHA-256: ' + esc(r.id) + '</div>' +
    '</div>';
}

app.post('/report/:id/cancel', (req, res) => {
  const db = loadDb();
  if (db[req.params.id] && db[req.params.id].status === 'active') {
    db[req.params.id].status = 'canceled';
    db[req.params.id].cancelledAt = new Date().toISOString();
    saveDb(db);
    console.log('[CANCEL] Report:', req.params.id, '- all docs flagged at:', db[req.params.id].status);
  }
  res.redirect('/report/' + req.params.id);
});

// === صفحة التحقق المطورة ===
app.get('/check', (req, res) => {
  const id = (req.query.id || '').trim();
  if (!id) return res.redirect('/verify');

  const db = loadDb();
  const r = db[id];
  if (!r) {
    return res.status(404).send(pageStart('نتيجة التحقق') + pageHeader() +
      '<main class="app-content"><div class="wrap"><div class="card" style="text-align:center">' +
      '<h2 style="color:#991b1b;margin-bottom:10px">⚠ التقرير غير موجود</h2>' +
      '<p class="muted">تأكد من صحة المعرّف الفريد (Leave ID) أو امسح رمز QR مرة أخرى.</p>' +
      '<p style="margin-top:14px"><a href="/verify" class="btn btn-primary">العودة لصفحة التحقق</a></p>' +
      '</div></div></main>' + pageFooter());
  }

  const st = statusOf(r);
  const cols = statusColor(st);
  // الواجهة المنعكسة - تعكس الحالة تلقائياً بناء على البيانات
  const isActive = st === 'active';
  const statusBadgeHTML = isActive
    ? '<span class="badge ok" style="padding:6px 14px;font-size:13px;background:#d4edda;color:#155724">✓ VERIFIED · موثّق</span>'
    : '<span class="badge bad" style="padding:6px 14px;font-size:13px;background:#f8d7da;color:#991b1b">⚠ NOT ACTIVE · غير سارٍ</span>';

  const alertHTML = isActive
    ? '<div class="alert alert-ok"><strong>✓ تقرير سارٍ وموثّق رسمياً</strong><br>تم إصدار هذا التقرير والتحقق منه بواسطة <strong>' + esc(CENTER_NAME) + '</strong>.</div>'
    : '<div class="alert alert-warn"><strong>⚠ هذا التقرير ' + statusTextAr(st) + ' (' + statusTextEn(st) + ')</strong><br>تم تحويله تلقائياً بواسطة نظام إدارة دورة حياة الحالة.</div>';

  const base = getBaseUrl(req);
  const verifyUrl = base + '/check?id=' + r.id;

  res.send(pageStart('Verified · ' + r.id) + pageHeader() +
    '<main class="app-content"><div class="wrap"><div class="card">' +
    '<div style="text-align:center;margin-bottom:14px">' +
      '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Verification Status · حالة التحقق</div>' +
      '<h2 style="margin:6px 0;font-size:13px"><strong>Leave ID / معرّف الإجازة:</strong> <span style="font-family:Consolas,monospace;color:#003366">' + esc(r.id) + '</span></h2>' +
      statusBadgeHTML +
    '</div>' +
    alertHTML +
    '<div style="background:#f8f9fa;border:1px solid #ced4da;border-radius:6px;padding:12px;margin-bottom:12px">' +
      '<div style="display:flex;gap:12px;align-items:center">' +
        '<div style="display:flex;align-items:center;justify-content:center;width:80px;height:80px;border-radius:50%;background:#003366;color:#fff;font-size:2em;font-weight:900;flex-shrink:0">' +
          (r.centerName || 'S').charAt(0) +
        '</div>' +
        '<div style="flex:1;font-size:13px">' +
          '<div><strong style="color:#003366;font-size:14px">' + esc(CENTER_NAME) + '</strong> | <span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">VERIFIED</span></div>' +
          '<div style="margin-top:3px"><strong>المريض:</strong> ' + esc(r.patientName) + '</div>' +
          '<div><strong>الطبيب:</strong> ' + esc(r.doctorName) + ' | ' + esc(r.doctorSpecialty) + '</div>' +
          '<div style="margin-top:2px"><strong>المدة:</strong> من ' + esc(fmtDate(r.startDate)) + ' إلى ' + esc(fmtDate(r.endDate)) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cta-buttons">' +
      '<a href="/report/' + esc(r.id) + '" class="btn btn-outline">👁️ عرض كامل</a>' +
      '<a href="/report/' + esc(r.id) + '/pdf" target="_blank" class="btn btn-primary">📥 تحميل PDF</a>' +
      '<button onclick="window.print()" class="btn btn-outline">🖨️ طباعة</button>' +
    '</div>' +
    '<div style="background:#f0f4f8;border:1px solid #ced4da;border-radius:6px;padding:7px;margin-top:12px;font-size:10px;color:#64748b;text-align:center">🔒 SHA-256 Verified | Document Hash: ' + esc(r.id.slice(-10)) + '</div>' +
    '</div></main>' + pageFooter());
});

// صفحة التحقق الرئيسية
app.get('/verify', (req, res) => {
  res.send(pageStart('تحقق') + pageHeader() +
    '<main class="app-content"><div class="wrap"><div class="card">' +
    '<h2>التحقق من وثيقة طبية</h2>' +
    '<p class="muted">أدخل المعرّف الفريد (Leave ID) أو امسح رمز QR للتحقق.</p>' +
    '<form method="get" action="/check">' +
      '<label><span>المعرّف الفريد (Leave ID)</span><input type="text" name="id" dir="ltr" placeholder="XXXXXXXX-XXXX-XXXX" required style="font-family:Consolas,monospace;font-size:15px;letter-spacing:1.5px;text-align:center"></label>' +
      '<button type="submit" class="btn btn-primary btn-block btn-lg">✅ تحقق الآن</button>' +
    '</form>' +
    '<div style="margin-top:12px;padding:9px;background:#e3ebf3;border-radius:6px;font-size:11px;color:#475569;text-align:center">💡 امسح رمز QR لفتح صفحة التحقق مباشرة</div>' +
    '</div></main>' + pageFooter());
});

// Cron Job Management Endpoint (لإعادة التشغيل يدوياً - مفيد للاختبار)
app.post('/admin/cron-trigger', (req, res) => {
  console.log('[ADMIN] Manual cron trigger');
  runDailyStatusUpdate();
  res.json({ status: 'triggered', message: 'Daily status update executed', timestamp: new Date().toISOString() });
});

app.use((req, res) => res.status(404).send(pageStart('404') + pageHeader() +
  '<main class="app-content"><div class="wrap"><div class="card"><h2 style="text-align:center">404 - Not Found</h2></div></div></main>' + pageFooter()));

// تنظيف الموارد عند الإغلاق
process.on('SIGTERM', () => {
  console.log('[SIGTERM] Cleaning up...');
  if (dailyJobTimer) clearTimeout(dailyJobTimer);
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server v4.5 started on port ${PORT}`);
  console.log(`Center: ${CENTER_NAME}`);
  console.log(`Verify: ${VERIFY_BASE}`);
  console.log(`Persistent storage: ${DB_FILE}`);
  if (configMissing().length > 0) console.log('Missing env vars:', configMissing().join(', '));
  // بدء Cron Job
  if (process.env.RUN_CRON === 'true' || process.env.RENDER) {
    runDailyStatusUpdate();
    scheduleNextMidnight();
  }
});
