const GROUPED_FLAG_KEY = 'useSvelteGroupedView';
const COMPLETED_FLAG_KEY = 'useSvelteCompletedView';
const TODO_FLAG_KEY = 'useSvelteTodoView';
const ALL_FLAG_KEY = 'useSvelteAllView';

export const enableSvelteGroupedSurface = () => {
  window.mosuRenderSurface = {
    ...(window.mosuRenderSurface || {}),
    [GROUPED_FLAG_KEY]: true,
  };
};

export const disableSvelteGroupedSurface = () => {
  if (!window.mosuRenderSurface) return;
  if (window.mosuRenderSurface[GROUPED_FLAG_KEY] === true) {
    delete window.mosuRenderSurface[GROUPED_FLAG_KEY];
  }
  if (Object.keys(window.mosuRenderSurface).length === 0) {
    delete window.mosuRenderSurface;
  }
};

export const enableSvelteCompletedSurface = () => {
  window.mosuRenderSurface = {
    ...(window.mosuRenderSurface || {}),
    [COMPLETED_FLAG_KEY]: true,
  };
};

export const disableSvelteCompletedSurface = () => {
  if (!window.mosuRenderSurface) return;
  if (window.mosuRenderSurface[COMPLETED_FLAG_KEY] === true) {
    delete window.mosuRenderSurface[COMPLETED_FLAG_KEY];
  }
  if (Object.keys(window.mosuRenderSurface).length === 0) {
    delete window.mosuRenderSurface;
  }
};

export const enableSvelteTodoSurface = () => {
  window.mosuRenderSurface = {
    ...(window.mosuRenderSurface || {}),
    [TODO_FLAG_KEY]: true,
  };
};

export const disableSvelteTodoSurface = () => {
  if (!window.mosuRenderSurface) return;
  if (window.mosuRenderSurface[TODO_FLAG_KEY] === true) {
    delete window.mosuRenderSurface[TODO_FLAG_KEY];
  }
  if (Object.keys(window.mosuRenderSurface).length === 0) {
    delete window.mosuRenderSurface;
  }
};

export const enableSvelteAllSurface = () => {
  window.mosuRenderSurface = {
    ...(window.mosuRenderSurface || {}),
    [ALL_FLAG_KEY]: true,
  };
};

export const disableSvelteAllSurface = () => {
  if (!window.mosuRenderSurface) return;
  if (window.mosuRenderSurface[ALL_FLAG_KEY] === true) {
    delete window.mosuRenderSurface[ALL_FLAG_KEY];
  }
  if (Object.keys(window.mosuRenderSurface).length === 0) {
    delete window.mosuRenderSurface;
  }
};
