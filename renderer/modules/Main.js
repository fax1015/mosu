/**
 * Main entry point for the modularized renderer
 * Imports all modules and initializes the application
 */

// ============================================
// Import Components (auto-initialize on import)
// ============================================
import './components/TooltipManager.js';
import './components/GlobalDatePicker.js';

// ============================================
// Import State Management
// ============================================
import * as Store from './state/Store.js';
import * as Persistence from './state/Persistence.js';

// ============================================
// Import Services
// ============================================
import { AudioController } from './services/AudioController.js';
import * as CoverLoader from './services/CoverLoader.js';
import * as TimelineRenderer from './services/TimelineRenderer.js';
import * as MapPreview from './services/MapPreview.js';
import * as BackgroundProcessor from './services/BackgroundProcessor.js';
import * as EmbedSync from './services/EmbedSync.js';
import * as ScanManager from './services/ScanManager.js';

// ============================================
// Import UI Builders
// ============================================
import * as ListItemBuilder from './ui/ListItemBuilder.js';
import * as GroupViewBuilder from './ui/GroupViewBuilder.js';
import * as VirtualList from './ui/VirtualList.js';
import * as StateRenderer from './ui/StateRenderer.js';
import * as TodoManager from './ui/TodoManager.js';
import * as DialogManager from './ui/DialogManager.js';
import * as SettingsUI from './ui/SettingsUI.js';

// ============================================
// Import Interaction Handlers
// ============================================
import * as EventDelegation from './interaction/EventDelegation.js';
import * as DragAndDrop from './interaction/DragAndDrop.js';
import * as KeyboardShortcuts from './interaction/KeyboardShortcuts.js';
import * as SearchHandler from './interaction/SearchHandler.js';

// ============================================
// Import File Operations
// ============================================
import * as DirectoryScanner from './fileOperations/DirectoryScanner.js';

// ============================================
// Import Item Processing
// ============================================
import * as ItemBuilder from './itemProcessing/ItemBuilder.js';
import * as ItemUpdater from './itemProcessing/ItemUpdater.js';

// ============================================
// Import Parsers
// ============================================
import * as BeatmapParser from './parsers/BeatmapParser.js';
import * as GuestDifficultyFilter from './parsers/GuestDifficultyFilter.js';

// ============================================
// Import Utilities
// ============================================
import * as Helpers from './utils/Helpers.js';
import * as Validation from './utils/Validation.js';

// ============================================
// Import App Initialization
// ============================================
import { init, loadSettings, applySettings } from './app/Initialization.js';
import * as UpdateChecker from './app/UpdateChecker.js';

// ============================================
// Import Bridge
// ============================================
import { beatmapApi, appInfo, tauriEvents, embedSyncApi } from './bridge/Tauri.js';

// ============================================
// Import Config
// ============================================
import * as Constants from './config/Constants.js';

// ============================================
// Initialize Application
// ============================================
const initializeApp = async () => {
    console.log('[mosu] Initializing modular application...');

    try {
        // Prepare callbacks for the init function
        const callbacks = {
            // File operations
            loadBeatmapFromDialog: DirectoryScanner.loadBeatmapFromDialog,
            loadBeatmapsByMapper: DirectoryScanner.loadBeatmapsByMapper,
            loadBeatmapsFromFolder: DirectoryScanner.loadBeatmapsFromFolder,
            refreshLastDirectory: DirectoryScanner.refreshLastDirectory,

            // UI rendering
            renderFromState: StateRenderer.renderFromState,
            updateTabCounts: StateRenderer.updateTabCounts,
            setLoading: StateRenderer.setLoading,
            updateProgress: StateRenderer.updateProgress,
            updateListItemElement: StateRenderer.updateListItemElement,

            // Item processing
            buildItemFromContent: ItemBuilder.buildItemFromContent,
            processWorkerResult: ItemBuilder.processWorkerResult,

            // Todo management
            toggleTodo: TodoManager.toggleTodo,
            toggleDone: TodoManager.toggleDone,

            // Audio
            playAudio: AudioController.play,
            stopAudio: AudioController.stop,

            // Search
            handleSearch: SearchHandler.handleSearchInput,

            // Persistence
            scheduleSave: Persistence.scheduleSave,
            saveToStorage: Persistence.saveToStorage,

            // Background processing
            processBackgroundQueues: BackgroundProcessor.processBackgroundQueues,
            scheduleAudioAnalysis: BackgroundProcessor.scheduleAudioAnalysis,
            scheduleStarRatingCalculation: BackgroundProcessor.scheduleStarRatingCalculation,
            queueMissingAudioAnalysis: BackgroundProcessor.queueMissingAudioAnalysisFromItems,
            queueMissingStarRating: BackgroundProcessor.queueMissingStarRatingFromItems,

            // Embed sync
            scheduleEmbedSync: EmbedSync.scheduleEmbedSync,

            // Virtual list
            syncVirtualList: VirtualList.syncVirtualList,
            rerenderVisibleTimelines: TimelineRenderer.rerenderVisibleTimelines,
            scheduleTimelineBatchRender: TimelineRenderer.scheduleTimelineBatchRender,
        };

        // Call the main init function
        await init(callbacks);

        console.log('[mosu] Application initialized successfully');
    } catch (error) {
        console.error('[mosu] Failed to initialize application:', error);
    }
};

// ============================================
// DOM Ready Initialization
// ============================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM already loaded
    initializeApp();
}

// ============================================
// Expose for Debugging (Optional)
// ============================================
window.mosuDebug = {
    // State
    Store,
    Persistence,

    // Services
    AudioController,
    CoverLoader,
    TimelineRenderer,
    MapPreview,
    BackgroundProcessor,
    EmbedSync,
    ScanManager,

    // UI
    ListItemBuilder,
    GroupViewBuilder,
    VirtualList,
    StateRenderer,
    TodoManager,
    DialogManager,
    SettingsUI,

    // Interaction
    EventDelegation,
    DragAndDrop,
    KeyboardShortcuts,
    SearchHandler,

    // File/Item Operations
    DirectoryScanner,
    ItemBuilder,
    ItemUpdater,

    // Parsers
    BeatmapParser,
    GuestDifficultyFilter,

    // Utils
    Helpers,
    Validation,

    // App
    UpdateChecker,
    loadSettings,
    applySettings,

    // Bridge
    beatmapApi,
    appInfo,
    tauriEvents,
    embedSyncApi,

    // Config
    Constants
};

console.log('[mosu] Main module loaded - waiting for DOM ready...');
