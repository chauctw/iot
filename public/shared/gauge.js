(function () {
    "use strict";

    if (window.ScadaGauge) {
        return;
    }

    class ScadaGauge {
        constructor(containerId, options = {}) {
            this.container = document.getElementById(containerId);

            if (!this.container) {
                console.error(`Không tìm thấy phần tử: #${containerId}`);
                return;
            }

            this.min = Number(options.min ?? 0);
            this.max = Number(options.max ?? 14);
            this.value = Number(options.value ?? 0);

            this.title = options.title ?? "CHỈ SỐ pH";
            this.unit = options.unit ?? "pH";

            // Màu mặc định (dùng khi colorMode = "static" hoặc không cấu hình theo giá trị)
            this.color = options.color ?? "#8BC34A";

            // ==== CẤU HÌNH ĐỔI MÀU THEO GIÁ TRỊ ====
            // colorMode: "static" | "zones" | "gradient"
            //  - static  : luôn dùng this.color
            //  - zones   : đổi màu theo từng khoảng giá trị (rời rạc)
            //  - gradient: nội suy màu liên tục theo phần trăm giá trị
            this.colorMode = options.colorMode ?? (options.zones ? "zones" : (options.colorStops ? "gradient" : "static"));

            // Ví dụ zones cho pH: acid (đỏ) - trung tính (xanh lá) - kiềm (vàng)
            this.zones = options.zones ?? [
                { max: 6, color: "#F44336" },
                { max: 8, color: "#8BC34A" },
                { max: Infinity, color: "#FFC107" }
            ];

            // Ví dụ colorStops (percent từ 0 -> 1 trên toàn thang min-max)
            this.colorStops = options.colorStops ?? [
                { percent: 0, color: "#F44336" },
                { percent: 0.5, color: "#8BC34A" },
                { percent: 1, color: "#3F51B5" }
            ];

            // Có đổi màu kim theo giá trị luôn không (mặc định: có, đồng bộ với vòng cung)
            this.needleFollowsValue = options.needleFollowsValue ?? true;

            // ==== CẤU HÌNH MAX ĐỘNG (AUTO-SCALE) ====
            // Khi bật: max của gauge luôn = (giá trị lớn nhất từng nhận được) + autoMaxPadding * giá trị đó
            // Ví dụ autoMaxPadding = 0.2 -> max = observedMax * 1.2 (dư 20%)
            this.autoMax = options.autoMax ?? false;
            this.autoMaxPadding = Number(options.autoMaxPadding ?? 0.2);

            // Giá trị lớn nhất từng quan sát được (chưa cộng đệm). Có thể mồi trước bằng options.autoMaxSeed
            this.observedMax = options.autoMaxSeed !== undefined
                ? Number(options.autoMaxSeed)
                : null;

            this.decimals = Number(options.decimals ?? 2);
            this.formatValue = options.formatValue || null;

            // Hiển thị dấu phân cách hàng nghìn theo chuẩn VN (vd: 1.234,56)
            this.grouping = options.grouping ?? true;

            // Làm tròn giá trị theo bước nhảy tuỳ chọn trước khi hiển thị
            // Ví dụ roundStep = 0.5 -> làm tròn về bội số gần nhất của 0.5 (0, 0.5, 1, 1.5...)
            // Mặc định null: chỉ làm tròn theo số chữ số thập phân (decimals)
            this.roundStep = options.roundStep ?? null;

            this.api = options.api || null;
            this.refreshInterval = Number(options.refreshInterval ?? 3000);
            this.timer = null;

            this.radius = 100;
            this.circumference = 2 * Math.PI * this.radius;
            this.arcLength = this.circumference * 0.75;

            this.render();
            this.setValue(this.value);

            if (this.api) {
                this.start();
            }
        }

        render() {
            this.container.innerHTML = `
                <div class="scada-gauge">
                    <div class="scada-gauge-container">
                        <svg viewBox="35 28 230 260" preserveAspectRatio="xMidYMid meet">
                            <g transform="rotate(135,150,175)">
                                <circle r="100" cx="150" cy="175" fill="#0D0D0D"></circle>

                                <circle
                                    r="100"
                                    cx="150"
                                    cy="175"
                                    stroke="#294273"
                                    stroke-width="20"
                                    stroke-linecap="round"
                                    stroke-dasharray="${this.arcLength} ${this.circumference}"
                                    fill="none">
                                </circle>

                                <circle
                                    class="gauge-progress"
                                    r="100"
                                    cx="150"
                                    cy="175"
                                    stroke="${this.color}"
                                    stroke-width="21"
                                    stroke-linecap="round"
                                    stroke-dasharray="0 ${this.circumference}"
                                    fill="none">
                                </circle>

                                <circle
                                    r="85"
                                    cx="150"
                                    cy="175"
                                    stroke="#F2F2F2"
                                    stroke-width="2"
                                    stroke-dasharray="399 533"
                                    fill="none">
                                </circle>
                            </g>

                            <g class="gauge-needle">
                                <polygon class="gauge-needle-tip" points="150,172 240,175 150,178" fill="#CCD0D9"></polygon>
                                <circle class="gauge-needle-hub" cx="150" cy="175" r="12" fill="#CCD0D9"></circle>
                                <circle cx="150" cy="175" r="5" fill="#0D0D0D"></circle>
                            </g>

                            <text fill="#000000" font-size="18" font-weight="700" font-family="Arial">
                                <tspan x="150" y="55" text-anchor="middle">${this.title}</tspan>
                            </text>

                            <text fill="#F2F2F2" font-size="18" font-family="Arial">
                                <tspan x="150" y="210" text-anchor="middle">${this.unit}</tspan>
                            </text>

                            <text fill="#FFFFFF" font-size="28" font-weight="700" font-family="Arial">
                                <tspan class="gauge-value" x="150" y="255" text-anchor="middle">0</tspan>
                            </text>
                        </svg>
                    </div>
                </div>
            `;

            this.progressEl = this.container.querySelector(".gauge-progress");
            this.needleEl = this.container.querySelector(".gauge-needle");
            this.needleTipEl = this.container.querySelector(".gauge-needle-tip");
            this.needleHubEl = this.container.querySelector(".gauge-needle-hub");
            this.valueEl = this.container.querySelector(".gauge-value");

            this.needleEl.style.transformOrigin = "150px 175px";
            this.needleEl.style.transition = "transform 0.5s ease-out";
            this.progressEl.style.transition = "stroke-dasharray 0.5s ease-out, stroke 0.3s ease-in-out";
        }

        parseNumber(value) {
            if (value === null || value === undefined) {
                return NaN;
            }

            if (typeof value === "number") {
                return value;
            }

            let text = String(value).trim();

            if (!text) return NaN;

            text = text.replace(/\s/g, "");

            if (text.includes(",") && text.includes(".")) {
                text = text.replace(/\./g, "").replace(",", ".");
            } else {
                text = text.replace(/,/g, "");
            }

            return Number(text);
        }

        /**
         * Làm tròn giá trị:
         * - Nếu có roundStep: làm tròn về bội số gần nhất của roundStep (vd 0.5, 5, 10...)
         * - Sau đó làm tròn theo số chữ số thập phân (decimals) để tránh sai số dấu phẩy động
         */
        roundValue(value) {
            let result = value;

            if (this.roundStep && this.roundStep > 0) {
                result = Math.round(result / this.roundStep) * this.roundStep;
            }

            const factor = Math.pow(10, this.decimals);
            result = Math.round((result + Number.EPSILON) * factor) / factor;

            // Tránh hiển thị "-0"
            return Object.is(result, -0) ? 0 : result;
        }

        formatDisplayValue(value) {
            const rounded = this.roundValue(value);

            if (typeof this.formatValue === "function") {
                return this.formatValue(rounded);
            }

            return rounded.toLocaleString("vi-VN", {
                minimumFractionDigits: this.decimals,
                maximumFractionDigits: this.decimals,
                useGrouping: this.grouping
            });
        }

        // ==== TIỆN ÍCH MÀU SẮC ====

        hexToRgb(hex) {
            const clean = hex.replace("#", "");
            const full = clean.length === 3
                ? clean.split("").map((c) => c + c).join("")
                : clean;

            const num = parseInt(full, 16);

            return {
                r: (num >> 16) & 255,
                g: (num >> 8) & 255,
                b: num & 255
            };
        }

        rgbToHex(r, g, b) {
            const toHex = (v) => Math.max(0, Math.min(255, Math.round(v)))
                .toString(16)
                .padStart(2, "0");

            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }

        interpolateColor(colorA, colorB, t) {
            const a = this.hexToRgb(colorA);
            const b = this.hexToRgb(colorB);

            return this.rgbToHex(
                a.r + (b.r - a.r) * t,
                a.g + (b.g - a.g) * t,
                a.b + (b.b - a.b) * t
            );
        }

        getColorForZones(value) {
            const sorted = [...this.zones].sort((a, b) => a.max - b.max);

            for (const zone of sorted) {
                if (value <= zone.max) {
                    return zone.color;
                }
            }

            return sorted.length ? sorted[sorted.length - 1].color : this.color;
        }

        getColorForGradient(percent) {
            const stops = [...this.colorStops].sort((a, b) => a.percent - b.percent);

            if (!stops.length) return this.color;
            if (percent <= stops[0].percent) return stops[0].color;
            if (percent >= stops[stops.length - 1].percent) return stops[stops.length - 1].color;

            for (let i = 0; i < stops.length - 1; i++) {
                const cur = stops[i];
                const next = stops[i + 1];

                if (percent >= cur.percent && percent <= next.percent) {
                    const span = next.percent - cur.percent || 1;
                    const t = (percent - cur.percent) / span;

                    return this.interpolateColor(cur.color, next.color, t);
                }
            }

            return this.color;
        }

        getColorForValue(value, percent) {
            if (this.colorMode === "zones") {
                return this.getColorForZones(value);
            }

            if (this.colorMode === "gradient") {
                return this.getColorForGradient(percent);
            }

            return this.color;
        }

        buildApiUrl() {
            if (!this.api) return null;

            if (this.api.url) {
                return this.api.url;
            }

            const params = new URLSearchParams();

            if (this.api.type === "sum") {
                params.set("source", this.api.source);
                params.set("parameter", this.api.parameter);
                params.set("station_ids", (this.api.stationIds || []).join(","));

                return `/api/sources/gauge-sum?${params.toString()}`;
            }

            if (this.api.type === "single") {
                params.set("source", this.api.source);
                params.set("station_id", this.api.stationId);
                params.set("parameter", this.api.parameter);

                return `/api/sources/gauge?${params.toString()}`;
            }

            return null;
        }

        async refresh() {
            const url = this.buildApiUrl();

            if (!url) return;

            try {
                const res = await fetch(url, {
                    cache: "no-store"
                });

                const json = await res.json();
                const value = this.parseNumber(json.value);

                if (json.success && Number.isFinite(value)) {
                    this.setValue(value);
                } else {
                    console.warn("Gauge API không có giá trị hợp lệ:", json);
                }
            } catch (err) {
                console.error("Lỗi tải dữ liệu gauge:", err);
            }
        }

        start() {
            this.stop();
            this.refresh();

            this.timer = setInterval(() => {
                this.refresh();
            }, this.refreshInterval);
        }

        stop() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        }

        setValue(value) {
            const parsedValue = this.parseNumber(value);

            if (!Number.isFinite(parsedValue)) {
                return;
            }

            // ==== TỰ CẬP NHẬT MAX ĐỘNG ====
            if (this.autoMax) {
                if (this.observedMax === null || parsedValue > this.observedMax) {
                    this.observedMax = parsedValue;
                    this.max = this.observedMax > this.min
                        ? this.observedMax * (1 + this.autoMaxPadding)
                        : this.min;
                }
            }

            const safeMax = this.max === this.min
                ? this.min + 1
                : this.max;

            const val = Math.max(this.min, Math.min(safeMax, parsedValue));
            const percent = (val - this.min) / (safeMax - this.min);

            const dash = this.arcLength * percent;

            this.progressEl.setAttribute(
                "stroke-dasharray",
                `${dash} ${this.circumference}`
            );

            const angle = 135 + percent * 270;
            this.needleEl.style.transform = `rotate(${angle}deg)`;

            // ==== ÁP DỤNG MÀU THEO GIÁ TRỊ ====
            const color = this.getColorForValue(val, percent);

            this.progressEl.style.stroke = color;
            this.progressEl.style.color = color; // dùng cho drop-shadow(currentColor) trong CSS
            this.valueEl.style.fill = color;

            if (this.needleFollowsValue) {
                this.needleTipEl.setAttribute("fill", color);
                this.needleHubEl.setAttribute("fill", color);
            }

            this.value = val;
            this.valueEl.textContent = this.formatDisplayValue(val);
        }

        setTitle(title) {
            this.title = title;
            this.render();
            this.setValue(this.value);
        }

        setApi(api) {
            this.api = api;
            this.start();
        }

        /**
         * Bật/tắt chế độ tự co giãn max.
         * @param {boolean} enabled
         * @param {object} [opts] { padding, seed } - seed để mồi lại observedMax
         */
        setAutoMax(enabled, opts = {}) {
            this.autoMax = enabled;

            if (opts.padding !== undefined) {
                this.autoMaxPadding = Number(opts.padding);
            }

            if (opts.seed !== undefined) {
                this.observedMax = Number(opts.seed);
                this.max = this.observedMax > this.min
                    ? this.observedMax * (1 + this.autoMaxPadding)
                    : this.min;
            }

            this.setValue(this.value);
        }

        /** Xoá mốc giá trị lớn nhất đã ghi nhận, để max co giãn lại từ giá trị hiện tại */
        resetAutoMax(seed) {
            this.observedMax = seed !== undefined ? Number(seed) : this.value;

            if (this.autoMax) {
                this.max = this.observedMax > this.min
                    ? this.observedMax * (1 + this.autoMaxPadding)
                    : this.min;
            }

            this.setValue(this.value);
        }

        setColorMode(mode, config) {
            this.colorMode = mode;

            if (mode === "zones" && config) this.zones = config;
            if (mode === "gradient" && config) this.colorStops = config;

            this.setValue(this.value);
        }
    }

    window.ScadaGauge = ScadaGauge;
})();