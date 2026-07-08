function normalizePath(path) {
    return path
        .replace(/\/+/g, '/')
        .replace(/\/index\.html$/, '/');
}

function initNavigation() {
    const currentPath = normalizePath(window.location.pathname);

    document.querySelectorAll('.menu-item').forEach(item => {
        // Lấy href từ thẻ a, hoặc từ thuộc tính data-href nếu là thẻ div/li
        const href = item.getAttribute('href') || item.getAttribute('data-href');

        if (!href) return;

        const linkPath = normalizePath(
            new URL(href, window.location.origin).pathname
        );

        const isHome =
            linkPath === '/' &&
            (currentPath === '/' || currentPath === '/index.html');

        item.classList.toggle(
            'active',
            isHome || currentPath === linkPath
        );

        // --- THÊM ĐOẠN CODE NÀY ĐỂ KÍCH HOẠT SỰ KIỆN CLICK ---
        // Xóa sự kiện cũ trước để tránh bị trùng lặp (nếu có)
        item.removeEventListener('click', handleMenuClick);
        // Gắn sự kiện click mới
        item.addEventListener('click', handleMenuClick);
    });
}

// Hàm xử lý khi click vào menu sidebar
function handleMenuClick(e) {
    const href = this.getAttribute('href') || this.getAttribute('data-href');
    if (!href) return;

    // Nếu bạn làm web truyền thống (đổi file html), dùng dòng này:
    window.location.href = href; 

    // Nếu bạn làm web SPA (load động), bỏ dấu // ở 2 dòng dưới và comment dòng trên:
    // e.preventDefault();
    // window.history.pushState(null, '', href);
}


document.addEventListener('layout:ready', initNavigation);