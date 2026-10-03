let cb: any = null;
export default { addEventListener(f: any) { cb = f; return () => {}; } };
export const setNet = (online: boolean) => cb?.({ isConnected: online, isInternetReachable: online });
