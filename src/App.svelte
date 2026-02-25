<script>
  import CustomTooltip from './components/CustomTooltip.svelte';
  import NotificationCenter from './components/NotificationCenter.svelte';
  import AppHeader from './components/AppHeader.svelte';
  import StickyHeader from './components/StickyHeader.svelte';
  import MainList from './components/MainList.svelte';
  import ClearAllPromptDialog from './components/dialogs/ClearAllPromptDialog.svelte';
  import WelcomePromptDialog from './components/dialogs/WelcomePromptDialog.svelte';
  import FirstRunPromptDialog from './components/dialogs/FirstRunPromptDialog.svelte';
  import MapperPromptDialog from './components/dialogs/MapperPromptDialog.svelte';
  import SongsDirPromptDialog from './components/dialogs/SongsDirPromptDialog.svelte';
  import SettingsDialog from './components/dialogs/SettingsDialog.svelte';
  import AboutDialog from './components/dialogs/AboutDialog.svelte';
  import ChangelogDialog from './components/dialogs/ChangelogDialog.svelte';
</script>

<CustomTooltip />
<NotificationCenter />
<AppHeader />
<StickyHeader />
<MainList />
<ClearAllPromptDialog />
<WelcomePromptDialog />
<FirstRunPromptDialog />
<MapperPromptDialog />
<SongsDirPromptDialog />
<SettingsDialog />
<AboutDialog />
<ChangelogDialog />
