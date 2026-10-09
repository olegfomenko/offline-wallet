// Stroke icons, as drawn in the design.
import { h } from 'preact';

const S = ({ size = 18, sw = 1.8, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...p}>{children}</svg>
);

export const IKey = (p) => <S {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></S>;
export const INoNet = (p) => <S size={16} {...p}><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M14.8 10.1A10 10 0 0 1 19 12.9M12 20h.01" /></S>;
export const INet = (p) => <S size={16} {...p}><path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01" /></S>;
export const IBack = (p) => <S size={22} sw={2} {...p}><path d="M15 6l-6 6 6 6" /></S>;
export const IMenu = (p) => <S size={22} {...p}><path d="M4 6h16M4 12h16M4 18h16" /></S>;
export const IClose = (p) => <S size={20} sw={2.2} {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IChev = (p) => <S size={16} sw={2} {...p}><path d="M9 6l6 6-6 6" /></S>;
export const IChevDown = (p) => <S size={16} sw={2} {...p}><path d="M6 9l6 6 6-6" /></S>;
export const ICheck = (p) => <S size={16} sw={2.4} {...p}><path d="M5 12l5 5 9-10" /></S>;
export const IHome = (p) => <S {...p}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></S>;
export const IScan = (p) => <S {...p}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" /></S>;
export const IList = (p) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>;
export const ISigned = (p) => <S {...p}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" /></S>;
export const ISearch = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5" /></S>;
export const ILock = (p) => <S {...p}><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>;
export const IGear = (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></S>;
export const IExport = (p) => <S sw={2} {...p}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v8h14v-8" /></S>;
export const IImport = (p) => <S sw={2} {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 12v8h14v-8" /></S>;
export const ILockSm = (p) => <S size={14} sw={2} {...p}><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>;
export const IEye = (p) => <S sw={2} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></S>;
export const ICopy = (p) => <S sw={2} {...p}><rect x="9" y="9" width="12" height="12" /><path d="M5 15H3V3h12v2" /></S>;
export const IQr = (p) => <S sw={2} {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></S>;
export const IFile = (p) => <S sw={2} {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></S>;
export const IKeyboard = (p) => <S size={20} {...p}><rect x="2" y="6" width="20" height="12" rx="1" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></S>;
export const IPaste = (p) => <S size={20} {...p}><rect x="6" y="4" width="12" height="17" /><path d="M9 4V2h6v2" /></S>;
export const ICamera = (p) => <S size={20} {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></S>;
export const IImage = (p) => <S size={20} {...p}><rect x="4" y="5" width="16" height="14" /><circle cx="9" cy="10" r="1.6" /><path d="M20 16l-5-5-8 8" /></S>;
export const IWarn = (p) => <S size={20} sw={2} {...p}><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4M12 17.5h.01" /></S>;
export const IInfo = (p) => <S size={20} sw={2} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>;
export const IDice = (p) => <S size={28} sw={1.6} {...p}><rect x="3.5" y="3.5" width="17" height="17" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></S>;
export const ICoin = (p) => <S size={28} sw={1.6} {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /></S>;
export const IDraw = (p) => <S size={28} sw={1.6} {...p}><path d="M3 17c3-6 5-9 7-9s1 6 4 6 4-7 7-9" /></S>;
export const IDownload = (p) => <S sw={2} {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 21h16" /></S>;
