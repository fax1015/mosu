# Agent Guidelines for mosu!

Welcome! This document provides essential information for AI agents working on the **mosu!** project. Follow these guidelines to ensure consistency and maintainability.

## 🎯 Project Goal
**mosu!** is a desktop application (built with Tauri) that helps osu! mappers track the progress of their beatmaps. It provides a visual timeline of mapping progress, allows for quick audio previews, and manages Todo/Completed lists.

## 🏗️ Architecture & Tech Stack
- **Framework**: [Tauri v2](https://v2.tauri.app/)
- **Frontend**: Vanilla JavaScript, HTML5, and CSS3.
    - **Location**: `renderer/`
    - **Logic**: `renderer/renderer.js` (Main heart of the frontend)
    - **Styling**: `renderer/style.css`
    - **Structure**: `renderer/index.html`
- **Backend**: Rust
    - **Location**: `src-tauri/`
    - **Main File**: `src-tauri/src/main.rs`
- **Data Persistence**: `localStorage` (for settings and maps) and filesystem (for .osu files and covers).

## 📂 Key Components to Know
- **`renderer/renderer.js`**: Contains all the logic for parsing `.osu` files, rendering the list, handling filtering/sorting, and communicating with the Rust backend via `window.__TAURI__`.
- **Tooltip System**: Use the `TooltipManager` in `renderer.js`. Add the `data-tooltip` attribute to any HTML element to show a tooltip.
- **Date Picker**: Use `GlobalDatePicker` for selecting dates.
- **Assets Protocol**: Images (covers) are loaded using the Tauri `asset` protocol for performance.
- **Embed Sync**: A feature that syncs data to an external site (`mosu-embed-site.vercel.app`). Logic is in `renderer.js` under the `syncToEmbed` related functions.

## 📋 Critical Guidelines & Workflows

### 1. Updating the Version & Changelog
**MANDATORY:** When you update the version tag in `package.json` and `src-tauri/tauri.conf.json`:
- You **MUST** update the version tag in `renderer/index.html` (look for `id="changelogVersionTag"` and the value around line 432).
- You **MUST** update the `<ul class="changelog-list">` in `renderer/index.html` to reflect the changes made in the new version.

### 2. UI & Styling
- **No Frameworks**: Do NOT add React, Vue, or any other frontend framework. Stick to Vanilla JS.
- **CSS Variables**: Always use the CSS variables defined in `:root` inside `renderer/style.css` for colors and spacing.
- **Responsive Design**: The app is designed for a fixed minimum width. Ensure new elements fit within the `850px` minimum.

### 3. Logic & State
- **State management**: The app uses simple global variables (e.g., `beatmapItems`, `settings`) in `renderer.js`.
- **Parsing**: If modifying how beatmaps are parsed, look at the `parseMetadata`, `parseHitObjects`, etc., functions.

## ✅ Do's and ❌ Don'ts

### ✅ Do
- Use semantic HTML elements.
- Maintain the current clean, dark-themed aesthetic.
- Use `tauri-bridge.js` for common Tauri interactions if applicable.
- Comment complex parsing logic or backend IPC calls.

### ❌ Don't
- **Don't** add external JS dependencies (npm packages for the frontend) unless absolutely necessary and approved by the user.
- **Don't** use inline styles; keep styles in `style.css`.
- **Don't** break the custom tooltip or date picker systems.
- **Don't** modify `Cargo.lock` manually unless you know what you're doing.

## 🛠️ Common Commands
- `npm run dev` - To start the app in development mode with hot reload.
- `npm run build` - To create a release build.
