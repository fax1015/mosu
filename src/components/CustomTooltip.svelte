<script>
  import { onDestroy, onMount } from 'svelte';

  let tooltipEl = null;
  let timeout = null;
  let currentTrigger = null;
  let observer = null;

  const delay = 500;

  const clearTimer = () => {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = null;
  };

  const updatePosition = () => {
    if (!tooltipEl || !currentTrigger) return;

    const triggerRect = currentTrigger.getBoundingClientRect();
    const originalTransform = tooltipEl.style.transform;
    tooltipEl.style.transform = 'none';
    tooltipEl.style.display = 'block';

    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;

    tooltipEl.style.transform = originalTransform;
    if (!tooltipEl.classList.contains('visible')) {
      tooltipEl.style.display = '';
    }

    let left = triggerRect.left + (triggerRect.width / 2) - (tooltipWidth / 2);
    let top = triggerRect.top - tooltipHeight - 12;
    let isTop = true;

    const padding = 16;
    const winWidth = window.innerWidth;

    if (left < padding) {
      left = padding;
    } else if (left + tooltipWidth > winWidth - padding) {
      left = winWidth - tooltipWidth - padding;
    }

    if (top < padding) {
      top = triggerRect.bottom + 12;
      isTop = false;
    }

    const arrowLeft = triggerRect.left + (triggerRect.width / 2) - left;
    tooltipEl.style.setProperty('--arrow-left', `${Math.round(arrowLeft)}px`);
    tooltipEl.classList.toggle('mosu-tooltip--top', isTop);
    tooltipEl.classList.toggle('mosu-tooltip--bottom', !isTop);
    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  };

  const hide = () => {
    clearTimer();
    observer?.disconnect();
    currentTrigger = null;
    tooltipEl?.classList.remove('visible');
  };

  const updateContent = () => {
    if (!tooltipEl || !currentTrigger) return;
    const text = currentTrigger.getAttribute('data-tooltip');
    if (!text) {
      hide();
      return;
    }

    tooltipEl.textContent = text;
    requestAnimationFrame(() => {
      if (currentTrigger) updatePosition();
    });
  };

  const show = (trigger) => {
    if (!observer || !tooltipEl) return;
    observer.disconnect();
    observer.observe(trigger, { attributes: true, attributeFilter: ['data-tooltip'] });
    updateContent();
    tooltipEl.classList.add('visible');
  };

  const startTimer = (trigger) => {
    clearTimer();
    currentTrigger = trigger;
    timeout = setTimeout(() => {
      show(trigger);
    }, delay);
  };

  onMount(() => {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-tooltip') {
          updateContent();
        }
      }
    });

    const onMouseOver = (e) => {
      const trigger = e.target.closest('[data-tooltip]');
      if (trigger && trigger !== currentTrigger) {
        startTimer(trigger);
      } else if (!trigger && currentTrigger) {
        hide();
      }
    };

    const onMouseOut = (e) => {
      const trigger = e.target.closest('[data-tooltip]');
      if (trigger && trigger === currentTrigger) {
        const related = e.relatedTarget;
        if (!related || !trigger.contains(related)) {
          hide();
        }
      }
    };

    const onMouseDown = () => hide();
    const onScroll = () => hide();
    const onResize = () => hide();

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      hide();
    };
  });

  onDestroy(() => {
    hide();
    observer?.disconnect();
    observer = null;
  });
</script>

<div bind:this={tooltipEl} id="mosuCustomTooltip" class="custom-tooltip" role="tooltip"></div>
