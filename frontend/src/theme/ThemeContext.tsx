import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

export interface AppearanceSettings {
  primaryColor: string;
  lightBackground: string;
  darkBackground: string;
  lightSurface:string;
  darkSurface:string;
  lightSidebar:string;
  darkSidebar:string;
  lightTopbar:string;
  darkTopbar:string;
  textMode:'auto'|'light'|'dark';
}

interface ThemeValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  appearance: AppearanceSettings;
  setAppearance: (appearance: AppearanceSettings) => void;
  resetAppearance: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = 'mm.theme';
const APPEARANCE_STORAGE_KEY = 'sgb.appearance.v1';
export const defaultAppearance: AppearanceSettings = {
  primaryColor: '#16834f',
  lightBackground: '#f4f7f5',
  darkBackground: '#0c1210',
  lightSurface:'#ffffff',
  darkSurface:'#18211d',
  lightSidebar:'#10251c',
  darkSidebar:'#09150f',
  lightTopbar:'#ffffff',
  darkTopbar:'#121a16',
  textMode:'auto',
};

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function initialAppearance(): AppearanceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null') as Partial<AppearanceSettings> | null;
    return {
      primaryColor: validColor(saved?.primaryColor) ? saved.primaryColor : defaultAppearance.primaryColor,
      lightBackground: validColor(saved?.lightBackground) ? saved.lightBackground : defaultAppearance.lightBackground,
      darkBackground: validColor(saved?.darkBackground) ? saved.darkBackground : defaultAppearance.darkBackground,
      lightSurface:validColor(saved?.lightSurface)?saved.lightSurface:defaultAppearance.lightSurface,
      darkSurface:validColor(saved?.darkSurface)?saved.darkSurface:defaultAppearance.darkSurface,
      lightSidebar:validColor(saved?.lightSidebar)?saved.lightSidebar:defaultAppearance.lightSidebar,
      darkSidebar:validColor(saved?.darkSidebar)?saved.darkSidebar:defaultAppearance.darkSidebar,
      lightTopbar:validColor(saved?.lightTopbar)?saved.lightTopbar:defaultAppearance.lightTopbar,
      darkTopbar:validColor(saved?.darkTopbar)?saved.darkTopbar:defaultAppearance.darkTopbar,
      textMode:['auto','light','dark'].includes(String(saved?.textMode))?saved!.textMode as AppearanceSettings['textMode']:defaultAppearance.textMode,
    };
  } catch { return defaultAppearance; }
}

function mixColor(left: string, right: string, rightWeight: number) {
  const parse = (value: string) => [1,3,5].map((index) => Number.parseInt(value.slice(index,index + 2),16));
  const a=parse(left);const b=parse(right);
  return `#${a.map((value,index)=>Math.round(value*(1-rightWeight)+b[index]*rightWeight).toString(16).padStart(2,'0')).join('')}`;
}

function isLight(value:string){const rgb=[1,3,5].map((index)=>Number.parseInt(value.slice(index,index+2),16));return (rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)/255>.58;}
function foreground(background:string,mode:AppearanceSettings['textMode']){return mode==='light'?'#f5faf7':mode==='dark'?'#17231d':isLight(background)?'#17231d':'#f2f8f4';}

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [appearance, setAppearanceState] = useState<AppearanceSettings>(initialAppearance);

  useEffect(() => {
    const root=document.documentElement;
    const background=theme==='dark'?appearance.darkBackground:appearance.lightBackground;
    const surface=theme==='dark'?appearance.darkSurface:appearance.lightSurface;
    const sidebar=theme==='dark'?appearance.darkSidebar:appearance.lightSidebar;
    // El encabezado y las barras nativas continúan el mismo fondo de pantalla.
    const topbar=background;
    const text=foreground(surface,appearance.textMode);const sidebarText=foreground(sidebar,appearance.textMode);const topbarText=foreground(topbar,appearance.textMode);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.style.setProperty('--primary',appearance.primaryColor);
    root.style.setProperty('--primary-dark',mixColor(appearance.primaryColor,theme==='dark'?'#ffffff':'#000000',theme==='dark'?.42:.24));
    root.style.setProperty('--primary-soft',mixColor(appearance.primaryColor,surface,theme==='dark'?.72:.86));
    root.style.setProperty('--page-bg',background);
    root.style.setProperty('--surface',surface);
    root.style.setProperty('--surface-alt',mixColor(surface,background,.38));
    root.style.setProperty('--surface-soft',mixColor(surface,background,.58));
    root.style.setProperty('--text',text);
    root.style.setProperty('--muted',mixColor(text,surface,.43));
    root.style.setProperty('--border',mixColor(text,surface,.82));
    root.style.setProperty('--sidebar-bg',sidebar);
    root.style.setProperty('--sidebar-text',sidebarText);
    root.style.setProperty('--sidebar-muted',mixColor(sidebarText,sidebar,.38));
    root.style.setProperty('--topbar-bg',topbar);
    root.style.setProperty('--topbar-text',topbarText);
    root.style.background=background;
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(APPEARANCE_STORAGE_KEY,JSON.stringify(appearance));
    const syncNativeBars=()=>{
      try { window.SGBAndroid?.setSystemBarColors?.(background,background); } catch { /* Solo Android. */ }
    };
    syncNativeBars();
    const retry=window.setTimeout(syncNativeBars,180);
    window.addEventListener('pageshow',syncNativeBars);
    return ()=>{window.clearTimeout(retry);window.removeEventListener('pageshow',syncNativeBars);};
  }, [theme,appearance]);

  const value = useMemo<ThemeValue>(() => ({
    theme,
    setTheme: setThemeState,
    toggleTheme: () => setThemeState((current) => current === 'dark' ? 'light' : 'dark'),
    appearance,
    setAppearance: setAppearanceState,
    resetAppearance: () => setAppearanceState(defaultAppearance),
  }), [theme,appearance]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme debe usarse dentro de ThemeProvider.');
  return context;
}
