let database;
async function db() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const req = indexedDB.open("my-badge-studio", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("documents", { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return database;
}
export async function put(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("documents", "readwrite");
    tx.objectStore("documents").put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function get(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction("documents").objectStore("documents").get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}
export async function list(prefix) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction("documents").objectStore("documents").getAll();
    req.onsuccess = () =>
      resolve(req.result.filter((r) => r.key.startsWith(prefix)));
    req.onerror = () => reject(req.error);
  });
}
export async function remove(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("documents", "readwrite");
    tx.objectStore("documents").delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
