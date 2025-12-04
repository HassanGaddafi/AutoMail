const API_URL = "https://api.mail.tm";

document.addEventListener('DOMContentLoaded', async () => {
    // 1. استرجاع الحالة
    chrome.storage.local.get(['emailAddress', 'jwtToken'], (result) => {
        if (result.emailAddress) {
            updateUIState(true, result.emailAddress);
        }
    });

    // 2. هل تم فتح النافذة من الإشعار؟
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'autocheck') {
        // نفذ عملية فحص الوارد فوراً
        setTimeout(() => checkInboxAndCopy(), 500); // تأخير بسيط لضمان تحميل الواجهة
    }
});

// --- زر الإنشاء والحقن ---
document.getElementById("fillBtn").addEventListener("click", async () => {
    const emailDisplay = document.getElementById("emailDisplay");
    const statusLabel = document.getElementById("statusLabel");
    
    statusLabel.innerText = "جاري العمل...";
    emailDisplay.innerText = "جاري الاتصال بالسيرفر...";

    try {
        // التحقق من الصفحة
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.url.startsWith("chrome://")) throw new Error("لا يمكن الحقن هنا");

        // جلب دومين عشوائي
        const domainRes = await fetch(`${API_URL}/domains`);
        const domainData = await domainRes.json();
        const domains = domainData['hydra:member'];
        const domain = domains[Math.floor(Math.random() * domains.length)].domain;

        // إنشاء الحساب
        const user = Math.random().toString(36).substring(7);
        const pass = Math.random().toString(36).substring(7);
        const email = `${user}@${domain}`;

        await fetch(`${API_URL}/accounts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: email, password: pass })
        });

        // جلب التوكن
        const tokenRes = await fetch(`${API_URL}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: email, password: pass })
        });
        const tokenData = await tokenRes.json();

        // حفظ البيانات
        chrome.storage.local.set({ emailAddress: email, jwtToken: tokenData.token });
        
        // تحديث الواجهة
        updateUIState(true, email);

        // بدء الحقن البشري
        statusLabel.innerText = "جاري الكتابة في الموقع...";
        await injectHumanLike(tab.id, email);
        statusLabel.innerText = "تم الحقن بنجاح ✅";

    } catch (e) {
        console.error(e);
        emailDisplay.innerText = "خطأ: " + e.message;
        statusLabel.innerText = "فشلت العملية";
    }
});

// --- زر فحص الوارد (يدوي) ---
document.getElementById("checkInbox").addEventListener("click", checkInboxAndCopy);

// --- زر إعادة الضبط (Reset) ---
document.getElementById("resetBtn").addEventListener("click", () => {
    chrome.storage.local.remove(['emailAddress', 'jwtToken'], () => {
        updateUIState(false);
        document.getElementById("messages").innerHTML = "";
        showToast("تمت إعادة تعيين الأداة 🔄");
    });
});

// --- دالة فحص الوارد والنسخ التلقائي ---
async function checkInboxAndCopy() {
    const listInfo = document.getElementById("messages");
    listInfo.innerHTML = "<li>جاري جلب الرسائل...</li>";

    const data = await chrome.storage.local.get(['jwtToken']);
    if (!data.jwtToken) {
        listInfo.innerHTML = "<li>لا يوجد حساب نشط</li>";
        return;
    }

    try {
        const res = await fetch(`${API_URL}/messages?page=1`, {
            headers: { "Authorization": `Bearer ${data.jwtToken}` }
        });
        const json = await res.json();
        const messages = json['hydra:member'];

        listInfo.innerHTML = "";
        if (!messages || messages.length === 0) {
            listInfo.innerHTML = "<li>لا توجد رسائل بعد...</li>";
            return;
        }

        // التعامل مع أحدث رسالة
        const msg = messages[0];
        const detailRes = await fetch(`${API_URL}/messages/${msg.id}`, {
            headers: { "Authorization": `Bearer ${data.jwtToken}` }
        });
        const detailData = await detailRes.json();

        // استخراج الكود
        const otpMatch = (detailData.text || detailData.intro || "").match(/\b\d{4,8}\b/);
        let otpHtml = "";

        if (otpMatch) {
            const code = otpMatch[0];
            otpHtml = `<span class="otp">الكود: ${code}</span>`;
            
            // --- النسخ التلقائي ---
            navigator.clipboard.writeText(code).then(() => {
                showToast(`تم نسخ الكود تلقائياً: ${code} 📋`);
            });
        }

        const li = document.createElement("li");
        li.innerHTML = `
            <div style="font-weight:bold; color:#444;">${msg.from.name || "مرسل غير معروف"}</div>
            <div style="margin:5px 0;">${msg.subject}</div>
            ${otpHtml}
        `;
        listInfo.appendChild(li);

    } catch (error) {
        console.error(error);
        listInfo.innerHTML = "<li>خطأ في الاتصال</li>";
    }
}

// --- دالة التحكم في حالة الواجهة ---
function updateUIState(isActive, email = "") {
    const fillBtn = document.getElementById("fillBtn");
    const resetBtn = document.getElementById("resetBtn");
    const emailDisplay = document.getElementById("emailDisplay");
    const statusLabel = document.getElementById("statusLabel");

    if (isActive) {
        emailDisplay.innerText = email;
        fillBtn.style.display = "none"; // إخفاء زر الإنشاء
        resetBtn.style.display = "flex"; // إظهار زر الإعادة
        statusLabel.innerText = "الحساب نشط (انتظار الكود)";
        emailDisplay.style.background = "#dcedc8";
        emailDisplay.style.border = "1px solid #8bc34a";
    } else {
        emailDisplay.innerText = "لا يوجد إيميل نشط";
        fillBtn.style.display = "flex";
        resetBtn.style.display = "none";
        statusLabel.innerText = "جاهز";
        emailDisplay.style.background = "#eee";
        emailDisplay.style.border = "1px dashed #ccc";
    }
}

// --- دالة الحقن البشري (Human Typing) ---
async function injectHumanLike(tabId, email) {
    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        args: [email],
        func: async (emailToType) => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            
            const inputs = document.querySelectorAll('input');
            let targetInput = null;

            // بحث ذكي عن الحقل
            for (let input of inputs) {
                const type = (input.getAttribute('type') || '').toLowerCase();
                const name = (input.getAttribute('name') || '').toLowerCase();
                const id = (input.getAttribute('id') || '').toLowerCase();
                const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                
                if (['email', 'e-mail', 'mail'].some(k => type === k || name.includes(k) || id.includes(k) || placeholder.includes(k))) {
                    targetInput = input;
                    break;
                }
            }

            if (targetInput) {
                targetInput.focus();
                targetInput.click();
                targetInput.value = "";

                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

                // حلقة الكتابة
                for (let i = 0; i < emailToType.length; i++) {
                    const char = emailToType[i];
                    
                    targetInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
                    targetInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

                    const newValue = targetInput.value + char;
                    
                    if (nativeInputValueSetter) {
                        nativeInputValueSetter.call(targetInput, newValue);
                    } else {
                        targetInput.value = newValue;
                    }

                    targetInput.dispatchEvent(new InputEvent('input', { data: char, bubbles: true }));
                    targetInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

                    // سرعة كتابة عشوائية (بين 30 و 100 ملي ثانية)
                    await sleep(Math.floor(Math.random() * 70) + 30);
                }

                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                targetInput.dispatchEvent(new Event('blur', { bubbles: true }));
                
                // وميض تأكيد
                targetInput.style.transition = "background 0.5s";
                targetInput.style.backgroundColor = "#c8e6c9";
                setTimeout(() => targetInput.style.backgroundColor = "", 1000);

            } else {
                console.warn("NinjaMail: لم أجد الحقل تلقائياً");
            }
        }
    });
}

function showToast(msg) {
    const x = document.getElementById("toast");
    x.innerText = msg;
    x.className = "show";
    setTimeout(() => { x.className = x.className.replace("show", ""); }, 3000);
}
