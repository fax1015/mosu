/**
 * GlobalDatePicker - A reusable date picker component
 */
const GlobalDatePicker = {
    popover: null,
    trigger: null,
    viewDate: new Date(),
    currentValue: null,
    onChange: null,
    _justClosedViaTrigger: false,

    /**
     * Format date as dd/mm/yyyy
     * @param {Date} date - Date to format
     * @returns {string} Formatted date string
     */
    formatDDMMYYYY(date) {
        if (!date) return '';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    },

    /**
     * Parse dd/mm/yyyy string to Date
     * @param {string} str - String to parse
     * @returns {Date|null} Parsed date or null
     */
    parseDDMMYYYY(str) {
        if (!str) return null;
        const parts = str.split('/');
        if (parts.length !== 3) return null;
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
        const date = new Date(year, month, day);
        if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) return null;
        return date;
    },

    init() {
        if (this.popover) return;
        this.popover = document.createElement('div');
        this.popover.classList.add('date-picker-popover');
        document.body.appendChild(this.popover);

        // Prevent focus stealing when clicking on the popover
        // This keeps the list item's extra-info-pane open
        this.popover.addEventListener('mousedown', (e) => {
            // Only prevent default for non-input elements to allow text selection
            if (!e.target.closest('input')) {
                e.preventDefault();
            }
        });

        // Close on outside click, or toggle close when clicking trigger
        document.addEventListener('mousedown', (e) => {
            if (this.popover.classList.contains('is-open')) {
                const isTrigger = this.trigger && this.trigger.contains(e.target);
                const isPopover = this.popover.contains(e.target);
                if (isTrigger) {
                    // Clicking trigger while open closes it
                    this._justClosedViaTrigger = true;
                    this.close();
                } else if (!isPopover) {
                    // Clicking outside both closes it
                    this.close();
                }
            }
        });
    },

    open(trigger, value, onChange) {
        this.init();
        this.trigger = trigger;
        this.currentValue = value;
        this.onChange = onChange;
        this.viewDate = value ? new Date(value) : new Date();

        this.render();
        this.updatePosition();

        this.popover.classList.add('is-open');
        this.trigger.classList.add('is-active');

        window.addEventListener('resize', this._updatePosBound);
        window.addEventListener('scroll', this._updatePosBound, true);
    },

    close() {
        if (!this.popover) return;
        this.popover.classList.remove('is-open');
        if (this.trigger) this.trigger.classList.remove('is-active');

        window.removeEventListener('resize', this._updatePosBound);
        window.removeEventListener('scroll', this._updatePosBound, true);
    },

    _updatePosBound: () => GlobalDatePicker.updatePosition(),

    updatePosition() {
        if (!this.trigger || !this.popover) return;
        const rect = this.trigger.getBoundingClientRect();
        const viewportMargin = 12;
        const popoverHeight = this.popover.offsetHeight || 360;
        const popoverWidth = this.popover.offsetWidth || 280;
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const showBelow = spaceBelow >= popoverHeight + 8 || spaceBelow >= spaceAbove;

        this.popover.classList.toggle('show-below', showBelow);
        const maxLeft = Math.max(viewportMargin, window.innerWidth - popoverWidth - viewportMargin);
        const left = Math.min(Math.max(rect.left, viewportMargin), maxLeft);
        this.popover.style.left = `${left}px`;

        const maxTop = Math.max(viewportMargin, window.innerHeight - popoverHeight - viewportMargin);
        if (showBelow) {
            const top = Math.min(Math.max(rect.bottom + 8, viewportMargin), maxTop);
            this.popover.style.top = `${top}px`;
            this.popover.style.bottom = 'auto';
        } else {
            const top = Math.min(Math.max(rect.top - popoverHeight - 8, viewportMargin), maxTop);
            this.popover.style.top = `${top}px`;
            this.popover.style.bottom = 'auto';
        }
    },

    render() {
        this.popover.innerHTML = '';
        const header = document.createElement('div');
        header.classList.add('date-picker-calendar-header');

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.classList.add('calendar-nav-btn');
        prevBtn.innerHTML = '<svg viewBox="0 0 320 512"><path d="M41.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 256 246.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z"/></svg>';
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewDate.setMonth(this.viewDate.getMonth() - 1);
            this.render();
        };

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.classList.add('calendar-nav-btn');
        nextBtn.innerHTML = '<svg viewBox="0 0 320 512"><path d="M278.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L210.7 256 73.4 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160z"/></svg>';
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewDate.setMonth(this.viewDate.getMonth() + 1);
            this.render();
        };

        const monthYear = document.createElement('div');
        monthYear.classList.add('calendar-month-year');
        monthYear.textContent = this.viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

        header.appendChild(prevBtn);
        header.appendChild(monthYear);
        header.appendChild(nextBtn);
        this.popover.appendChild(header);

        const grid = document.createElement('div');
        grid.classList.add('date-picker-grid');

        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(day => {
            const el = document.createElement('div');
            el.classList.add('calendar-weekday');
            el.textContent = day;
            grid.appendChild(el);
        });

        const firstDay = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), 1).getDay();
        const lastDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 0).getDate();

        for (let i = 0; i < firstDay; i++) {
            const el = document.createElement('div');
            el.classList.add('calendar-day', 'empty');
            grid.appendChild(el);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selectedDate = this.currentValue ? new Date(this.currentValue) : null;
        if (selectedDate) selectedDate.setHours(0, 0, 0, 0);

        for (let i = 1; i <= lastDate; i++) {
            const el = document.createElement('div');
            el.classList.add('calendar-day');
            el.textContent = i;
            const d = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), i);
            if (d.getTime() === today.getTime()) el.classList.add('is-today');
            if (selectedDate && d.getTime() === selectedDate.getTime()) el.classList.add('is-selected');

            el.onclick = (e) => {
                e.stopPropagation();
                d.setHours(23, 59, 59, 999);
                this.onChange(d.getTime());
                this.close();
            };
            grid.appendChild(el);
        }
        this.popover.appendChild(grid);

        const footer = document.createElement('div');
        footer.classList.add('date-picker-footer');

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.classList.add('date-picker-btn', 'date-picker-btn--clear');
        clearBtn.textContent = 'Clear';
        clearBtn.onclick = (e) => {
            e.stopPropagation();
            this.onChange(null);
            this.close();
        };

        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.classList.add('date-picker-btn', 'date-picker-btn--today');
        todayBtn.textContent = 'Today';
        todayBtn.onclick = (e) => {
            e.stopPropagation();
            const now = new Date();
            now.setHours(23, 59, 59, 999);
            this.onChange(now.getTime());
            this.close();
        };

        footer.appendChild(clearBtn);
        footer.appendChild(todayBtn);
        this.popover.appendChild(footer);
    }
};

// Expose to window for access from other modules
window.GlobalDatePicker = GlobalDatePicker;

export default GlobalDatePicker;
