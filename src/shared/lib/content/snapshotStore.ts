import { get, set } from 'idb-keyval'

const SNAPSHOT_KEY = 'knowhub-official-snapshot'
const SNAPSHOT_BACKUP_KEY = 'knowhub-official-snapshot-backup'

export class SnapshotStore {
  async load() {
    return (await get<Uint8Array>(SNAPSHOT_KEY)) ?? null
  }

  async save(bytes: Uint8Array) {
    await set(SNAPSHOT_KEY, bytes)
  }

  async saveBackup(bytes: Uint8Array) {
    await set(SNAPSHOT_BACKUP_KEY, bytes)
  }

  async loadBackup() {
    return (await get<Uint8Array>(SNAPSHOT_BACKUP_KEY)) ?? null
  }
}
