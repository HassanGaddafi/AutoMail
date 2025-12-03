chrome.runtime.onInstalled.addListener(() => {
    // تشغيل المنبه للفحص الدوري كل دقيقة
    chrome.alarms.create("checkInboxLoop", { periodInMinutes: 0.5 });
});

let lastMsgId = null;

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkInboxLoop") {
        checkNewMessages();
    }
});

async function checkNewMessages() {
    // نحتاج للتوكن للإتصال بالسيرفر
    const data = await chrome.storage.local.get(['jwtToken']);
    
    if (!data.jwtToken) return; 

    try {
        const response = await fetch("https://api.mail.tm/messages?page=1", {
            headers: { "Authorization": `Bearer ${data.jwtToken}` }
        });
        
        if (!response.ok) return; // قد يكون التوكن منتهي الصلاحية

        const json = await response.json();
        const messages = json['hydra:member']; // Mail.tm يضع الرسائل هنا

        if (messages && messages.length > 0) {
            const latestMsg = messages[0];

            if (latestMsg.id !== lastMsgId) {
                lastMsgId = latestMsg.id;

                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon.png',
                    title: `📩 ${latestMsg.from.name || latestMsg.from.address}`,
                    message: latestMsg.subject || "بدون عنوان",
                    priority: 2
                });
            }
        }
    } catch (error) {
        console.log("Background Error:", error);
    }
}