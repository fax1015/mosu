/**
 * TooltipManager - Handles custom tooltip display and positioning
 */
const TooltipManager = {
    element: null,
    timeout: null,
    currentTrigger: null,
    delay: 500, // Balanced delay for feel
    observer: null,

    init() {
        this.element = document.getElementById('mosuCustomTooltip');
        if (!this.element) {
            this.element = document.createElement('div');
            this.element.id = 'mosuCustomTooltip';
            this.element.className = 'custom-tooltip';
            document.body.appendChild(this.element);
        }

        // MutationObserver to watch for tooltip text changes on the active trigger
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-tooltip') {
                    this.updateContent();
                }
            }
        });

        // Event delegation for all elements with data-tooltip
        document.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger !== this.currentTrigger) {
                this.startTimer(trigger);
            } else if (!trigger && this.currentTrigger) {
                this.hide();
            }
        });

        document.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger === this.currentTrigger) {
                const related = e.relatedTarget;
                if (!related || !trigger.contains(related)) {
                    this.hide();
                }
            }
        });

        // Hide on click or scroll
        document.addEventListener('mousedown', () => this.hide());
        window.addEventListener('scroll', () => this.hide(), true);
        window.addEventListener('resize', () => this.hide());
    },

    startTimer(trigger) {
        this.clearTimer();
        this.currentTrigger = trigger;
        this.timeout = setTimeout(() => {
            this.show(trigger);
        }, this.delay);
    },

    clearTimer() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    },

    show(trigger) {
        this.observer.disconnect();
        this.observer.observe(trigger, { attributes: true, attributeFilter: ['data-tooltip'] });

        this.updateContent();
        this.element.classList.add('visible');
    },

    updateContent() {
        if (!this.currentTrigger || !this.element) return;
        const text = this.currentTrigger.getAttribute('data-tooltip');
        if (!text) {
            this.hide();
            return;
        }

        this.element.textContent = text;

        // Use requestAnimationFrame to ensure the DOM has updated and we can measure the new size correctly
        requestAnimationFrame(() => {
            if (this.currentTrigger) this.updatePosition();
        });
    },

    hide() {
        this.clearTimer();
        this.observer.disconnect();
        this.currentTrigger = null;
        if (this.element) {
            this.element.classList.remove('visible');
        }
    },

    updatePosition() {
        if (!this.element || !this.currentTrigger) return;

        const triggerRect = this.currentTrigger.getBoundingClientRect();

        // Temporary reset scale to 1 to measure natural width accurately
        const originalTransform = this.element.style.transform;
        this.element.style.transform = 'none';
        this.element.style.display = 'block';

        const tooltipWidth = this.element.offsetWidth;
        const tooltipHeight = this.element.offsetHeight;

        this.element.style.transform = originalTransform;
        if (!this.element.classList.contains('visible')) {
            this.element.style.display = '';
        }

        let left = triggerRect.left + (triggerRect.width / 2) - (tooltipWidth / 2);
        let top = triggerRect.top - tooltipHeight - 12; // Increased gap for arrow
        let isTop = true;

        // Viewport constraints
        const padding = 16;
        const winWidth = window.innerWidth;

        if (left < padding) {
            left = padding;
        } else if (left + tooltipWidth > winWidth - padding) {
            left = winWidth - tooltipWidth - padding;
        }

        // Flip to bottom if it overflows the top
        if (top < padding) {
            top = triggerRect.bottom + 12;
            isTop = false;
        }

        // Position the arrow to point exactly at the trigger center
        const arrowLeft = triggerRect.left + (triggerRect.width / 2) - left;
        this.element.style.setProperty('--arrow-left', `${Math.round(arrowLeft)}px`);

        this.element.classList.toggle('mosu-tooltip--top', isTop);
        this.element.classList.toggle('mosu-tooltip--bottom', !isTop);

        this.element.style.left = `${Math.round(left)}px`;
        this.element.style.top = `${Math.round(top)}px`;
    }
};

// Initialize Tooltip Manager
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TooltipManager.init());
} else {
    TooltipManager.init();
}

export default TooltipManager;
