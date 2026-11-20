/** Per-tab secrets: the host key and a player's resume key survive refreshes but not new tabs. */
const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const hostKeyFor = (code: string) => safe(() => sessionStorage.getItem(`nb:host:${code}`), null);
export const saveHostKey = (code: string, key: string) => safe(() => sessionStorage.setItem(`nb:host:${code}`, key), undefined);
export const resumeKeyFor = (code: string) => safe(() => sessionStorage.getItem(`nb:resume:${code}`), null);
export const saveResumeKey = (code: string, key: string) => safe(() => sessionStorage.setItem(`nb:resume:${code}`, key), undefined);
export const lastName = () => safe(() => localStorage.getItem("nb:name") ?? "", "");
export const saveName = (name: string) => safe(() => localStorage.setItem("nb:name", name), undefined);
