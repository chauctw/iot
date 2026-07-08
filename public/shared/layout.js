// Hàm Async Load Layout dùng chung từ Server
async function loadLayout() {
    const container = document.getElementById('layout-container');

    if (!container) {
        console.error('Không tìm thấy #layout-container trên trang chính');
        return;
    }

    try {
        // 1. Tải cấu trúc file Layout về
        const response = await fetch('/shared/layout.html');
        if (!response.ok) {
            throw new Error(`Lỗi tải file HTTP status: ${response.status}`);
        }
        container.innerHTML = await response.text();

        // 2. Chuyển các trang nội dung từ thẻ <template> vào trong Layout vừa load
        const pagesTemplate = document.getElementById('pages-template');
        const dynamicContainer = document.getElementById('dynamic-pages-container');
        
        if (pagesTemplate && dynamicContainer) {
            // Nhân bản nội dung bên trong template và chèn vào layout mới tải
            const clone = pagesTemplate.content.cloneNode(true);
            dynamicContainer.appendChild(clone);
        }

        // 3. Kích hoạt CustomEvent thông báo hệ thống DOM đã lắp ráp xong hoàn chỉnh
        document.dispatchEvent(new CustomEvent('layout:ready'));

    } catch (error) {
        console.error('Không load được layout.html:', error);
    }
}

// Lắng nghe khi cây DOM gốc sẵn sàng để bắt đầu kéo Layout
document.addEventListener('DOMContentLoaded', loadLayout);


// SỰ KIỆN CHUYỂN ĐỔI TAB (Chỉ kích hoạt khi Layout chắc chắn đã load xong)
document.addEventListener('layout:ready', function () {
    const tabs = document.querySelectorAll(".footer-tab");

    if (tabs.length === 0) {
        console.warn("Không tìm thấy nút điều hướng .footer-tab nào!");
        return;
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", function () {
            
            // Bước A: Cập nhật trạng thái hiển thị của nút bấm (Thanh Footer)
            const currentActiveTab = document.querySelector(".footer-tab.active");
            if (currentActiveTab) {
                currentActiveTab.classList.remove("active");
            }
            this.classList.add("active");

            // Bước B: Lấy ID của trang đích được chỉ định
            const targetPageId = this.getAttribute("data-target");

            // Bước C: Ẩn trang hiện tại đang hiển thị đi
            const currentPage = document.querySelector(".page-content.active-page");
            if (currentPage) {
                currentPage.classList.remove("active-page");
            }

            // Bước D: Hiển thị trang mới tương ứng
            const targetPage = document.getElementById(targetPageId);
            if (targetPage) {
                targetPage.classList.add("active-page");
            } else {
                console.error(`Không tìm thấy phân vùng trang nội dung có ID: ${targetPageId}`);
            }
        });
    });
});