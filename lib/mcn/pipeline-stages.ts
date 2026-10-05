// Stage pipeline brand_deals (tab BizDev). Sengaja di modul netral (bukan file
// "use client"): konstanta non-komponen yang di-import server component dari
// modul client berubah jadi client reference (bukan array) → `new Set(...)`
// di page.tsx melempar "function is not iterable" (digest 2968767755).
export const PIPELINE_STAGES = ["baru", "nego", "kontrak", "berjalan", "selesai"];
