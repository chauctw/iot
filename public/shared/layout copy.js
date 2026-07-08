// async function loadLayout() {
//     const container = document.getElementById('layout-container');

//     if (!container) {
//         console.error('Không tìm thấy #layout-container');
//         return;
//     }

//     try {
//         const response = await fetch('/shared/layout.html');

//         if (!response.ok) {
//             throw new Error(`HTTP ${response.status}`);
//         }

//         container.innerHTML = await response.text();

//         document.dispatchEvent(new CustomEvent('layout:ready'));
//     } catch (error) {
//         console.error('Không load được layout.html:', error);
//     }
// }

// document.addEventListener('DOMContentLoaded', loadLayout);

// 1. Giữ nguyên hàm loadLayout hiện tại của bạn
async function loadLayout() {
    const container = document.getElementById('layout-container');
    if (!container) {
        console.error('Không tìm thấy #layout-container');
        return;
    }

    try {
        const response = await fetch('/shared/layout.html');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        container.innerHTML = await response.text();

        // Kích hoạt sự kiện báo hiệu Layout đã được chèn vào DOM thành công
        document.dispatchEvent(new CustomEvent('layout:ready'));
    } catch (error) {
        console.error('Không load được layout.html:', error);
    }
}

// Gọi hàm load layout khi DOM trang chính sẵn sàng
document.addEventListener('DOMContentLoaded', loadLayout);


// 2. LẮNG NGHE SỰ KIỆN LAYOUT READY ĐỂ GẮN CLICK CHUYỂN TRANG
document.addEventListener('layout:ready', function () {
    // Lúc này các thẻ .footer-tab từ layout.html chắc chắn đã có trong DOM
    const tabs = document.querySelectorAll(".footer-tab");
    const pages = document.querySelectorAll(".page-content");

    if (tabs.length === 0) {
        console.warn("Không tìm thấy các thẻ .footer-tab sau khi layout ready!");
        return;
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", function () {
            // Tìm và xóa class active ở tab cũ
            const currentActiveTab = document.querySelector(".footer-tab.active");
            if (currentActiveTab) {
                currentActiveTab.classList.remove("active");
            }
            // Thêm active vào tab vừa click
            this.classList.add("active");

            // Lấy ID trang đích từ data-target
            const targetPageId = this.getAttribute("data-target");

            // Ẩn trang cũ
            const currentPage = document.querySelector(".page-content.active-page");
            if (currentPage) {
                currentPage.classList.remove("active-page");
            }

            // Hiển thị trang mới
            const targetPage = document.getElementById(targetPageId);
            if (targetPage) {
                targetPage.classList.add("active-page");
            } else {
                console.error(`Không tìm thấy trang có id: ${targetPageId}`);
            }
        });
    });
});