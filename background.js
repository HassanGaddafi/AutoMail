chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("checkInboxLoop", { periodInMinutes: 0.5 });
});

let lastMsgId = null;

// عند الضغط على الإشعار
chrome.notifications.onClicked.addListener((notifId) => {
    // فتح نافذة صغيرة تعرض صندوق الوارد مباشرة
    chrome.windows.create({
        url: "popup.html?action=autocheck", // نرسل أمر "فحص تلقائي" في الرابط
        type: "popup",
        width: 350,
        height: 600
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkInboxLoop") {
        checkNewMessages();
    }
});

async function checkNewMessages() {
    const data = await chrome.storage.local.get(['jwtToken']);
    if (!data.jwtToken) return; 

    try {
        const response = await fetch("https://api.mail.tm/messages?page=1", {
            headers: { "Authorization": `Bearer ${data.jwtToken}` }
        });
        
        if (!response.ok) return;

        const json = await response.json();
        const messages = json['hydra:member'];

        if (messages && messages.length > 0) {
            const latestMsg = messages[0];
            if (latestMsg.id !== lastMsgId) {
                lastMsgId = latestMsg.id;
                
                // إرسال الإشعار
                chrome.notifications.create(latestMsg.id, { // نستخدم ID الرسالة كمعرف للإشعار
                    type: 'basic',
                    iconUrl: 'icon.png',
                    title: `📩 كود جديد وصل!`,
                    message: `اضغط هنا لنسخ الكود من رسالة: ${latestMsg.subject}`,
                    priority: 2,
                    requireInteraction: true // يبقى الإشعار حتى يضغط عليه المستخدم
                });
            }
        }
    } catch (error) {
        console.log("Bg Error:", error);
    }
}
