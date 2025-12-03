const API_URL = "https://api.mail.tm";

// عند التحميل، عرض الإيميل المخزن
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['emailAddress'], (result) => {
        const display = document.getElementById("emailDisplay");
        if(display) display.innerText = result.emailAddress || "لا يوجد إيميل نشط";
    });
});

// زر النسخ اليدوي
const copyBtn = document.getElementById("copyBtn");
if (copyBtn) {
    copyBtn.addEventListener("click", () => {
        const email = document.getElementById("emailDisplay").innerText;
        if (email && email.includes("@")) {
            navigator.clipboard.writeText(email);
            showToast("تم نسخ الإيميل!");
        } else {
            showToast("لا يوجد إيميل لنسخه");
        }
    });
}

// --- زر الإنشاء والحقن (النسخة المحسنة) ---
const fillBtn = document.getElementById("fillBtn");
if (fillBtn) {
    fillBtn.addEventListener("click", async () => {
        const emailDisplay = document.getElementById("emailDisplay");
        emailDisplay.innerText = "جاري الاتصال...";
        emailDisplay.style.color = "blue";

        try {
            // 1. التحقق من التبويب الحالي قبل البدء
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
                throw new Error("لا يمكن الحقن في هذه الصفحة (محمية)");
            }

            // 2. جلب الدومين
            const domainRes = await fetch(`${API_URL}/domains`);
            if (!domainRes.ok) throw new Error(`خطأ السيرفر: ${domainRes.status}`);
            
            const domainData = await domainRes.json();
            const domainsList = domainData['hydra:member'];
            if (!domainsList || domainsList.length === 0) throw new Error("لا توجد دومينات متاحة");

            // اختيار دومين عشوائي
            const randomDomainObj = domainsList[Math.floor(Math.random() * domainsList.length)];
            const domain = randomDomainObj.domain;

            // 3. إنشاء الحساب
            const randomUser = Math.random().toString(36).substring(7);
            const password = Math.random().toString(36).substring(7);
            const email = `${randomUser}@${domain}`;

            const registerRes = await fetch(`${API_URL}/accounts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: email, password: password })
            });

            if (registerRes.status === 429) throw new Error("تم تجاوز الحد المسموح (انتظر قليلاً)");
            if (!registerRes.ok) throw new Error("فشل إنشاء الحساب");

            // 4. جلب التوكن
            const tokenRes = await fetch(`${API_URL}/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: email, password: password })
            });

            if (!tokenRes.ok) throw new Error("فشل جلب التوكن");
            const tokenData = await tokenRes.json();

            // حفظ وعرض
            chrome.storage.local.set({ emailAddress: email, jwtToken: tokenData.token });
            emailDisplay.innerText = email;
            emailDisplay.style.color = "black";

            // 5. محاولة الحقن
            await injectEmailFunc(tab.id, email);

        } catch (e) {
            console.error(e);
            emailDisplay.innerText = e.message; // عرض الخطأ للمستخدم
            emailDisplay.style.color = "red";
        }
    });
}

// --- زر فحص الوارد ---
const checkInboxBtn = document.getElementById("checkInbox");
if (checkInboxBtn) {
    checkInboxBtn.addEventListener("click", async () => {
        const listInfo = document.getElementById("messages");
        listInfo.innerHTML = "<li>جاري التحديث...</li>";

        chrome.storage.local.get(['jwtToken'], async (data) => {
            if (!data.jwtToken) {
                listInfo.innerHTML = "<li>أنشئ حساباً أولاً</li>";
                return;
            }

            try {
                const res = await fetch(`${API_URL}/messages?page=1`, {
                    headers: { "Authorization": `Bearer ${data.jwtToken}` }
                });
                
                if (res.status === 401) {
                    listInfo.innerHTML = "<li>انتهت الجلسة، أنشئ إيميلاً جديداً</li>";
                    return;
                }

                const json = await res.json();
                const messages = json['hydra:member'];

                listInfo.innerHTML = "";
                if (!messages || messages.length === 0) {
                    listInfo.innerHTML = "<li>لا توجد رسائل...</li>";
                    return;
                }

                const msg = messages[0];
                const detailRes = await fetch(`${API_URL}/messages/${msg.id}`, {
                    headers: { "Authorization": `Bearer ${data.jwtToken}` }
                });
                const detailData = await detailRes.json();

                const otpMatch = (detailData.text || "").match(/\b\d{4,8}\b/);
                let otpHtml = "";
                if (otpMatch) {
                    const code = otpMatch[0];
                    otpHtml = `<span class="otp">الكود: ${code}</span>`;
                    navigator.clipboard.writeText(code).then(() => showToast(`تم نسخ: ${code}`));
                }

                const li = document.createElement("li");
                li.innerHTML = `<strong>من:</strong> ${msg.from.name || msg.from.address}<br><strong>الموضوع:</strong> ${msg.subject}<br>${otpHtml}`;
                listInfo.appendChild(li);

            } catch (error) {
                console.error(error);
                listInfo.innerHTML = "<li>خطأ في الشبكة</li>";
            }
        });
    });
}

// --- دالة الحقن (مفصولة ومحمية) ---
// استبدل دالة injectEmailFunc القديمة بهذه الجديدة
async function injectEmailFunc(tabId, email) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            args: [email],
            func: async (emailToType) => {
                // 1. دالة مساعدة لعمل تأخير زمني (Wait)
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                // 2. البحث عن الحقل
                const inputs = document.querySelectorAll('input');
                let targetInput = null;

                for (let input of inputs) {
                    const type = (input.getAttribute('type') || '').toLowerCase();
                    const name = (input.getAttribute('name') || '').toLowerCase();
                    const id = (input.getAttribute('id') || '').toLowerCase();
                    
                    if (type === 'email' || name.includes('email') || id.includes('email')) {
                        targetInput = input;
                        break;
                    }
                }

                if (targetInput) {
                    // التركيز وتنظيف الحقل أولاً
                    targetInput.focus();
                    targetInput.click();
                    targetInput.value = ""; 
                    
                    // استدعاء React Setter (مهم جداً)
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

                    // 3. حلقة الكتابة (حرفاً بحرف)
                    for (let i = 0; i < emailToType.length; i++) {
                        const char = emailToType[i];
                        
                        // محاكاة ضغط الزر للأسفل
                        targetInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
                        targetInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

                        // إضافة الحرف للقيمة الحالية
                        const newValue = targetInput.value + char;
                        
                        // تحديث القيمة بطريقة يفهمها React
                        if (nativeInputValueSetter) {
                            nativeInputValueSetter.call(targetInput, newValue);
                        } else {
                            targetInput.value = newValue;
                        }

                        // إشعار الموقع بأن تغييراً حدث
                        targetInput.dispatchEvent(new InputEvent('input', { data: char, bubbles: true }));
                        
                        // محاكاة رفع الإصبع عن الزر
                        targetInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

                        // تأخير عشوائي بين 50 و 150 ملي ثانية (ليشعر الموقع أنه إنسان)
                        await sleep(Math.floor(Math.random() * 100) + 50);
                    }

                    // 4. إنهاء العملية
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                    targetInput.dispatchEvent(new Event('blur', { bubbles: true }));

                    // تلوين الحقل للإشارة للنجاح
                    targetInput.style.border = "2px solid #2ecc71";
                    targetInput.style.backgroundColor = "#e8f8f5";
                    
                } else {
                    console.warn("NinjaMail: No email input found.");
                }
            }
        });
    } catch (err) {
        console.error("Injection failed:", err);
    }
}

function showToast(msg) {
    const x = document.getElementById("toast");
    if (x) {
        x.innerText = msg;
        x.className = "show";
        setTimeout(() => { x.className = x.className.replace("show", ""); }, 3000);
    }
}