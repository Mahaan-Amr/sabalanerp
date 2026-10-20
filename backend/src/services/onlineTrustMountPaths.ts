import path from 'node:path';
export type TrustMountPath = Readonly<{ id: string; device: string; root: string; target: string; options: readonly string[] }>;
/** Pure mount path projection. This grants no trust; the native caller must
 * still verify the selected mnt_id, frozen mount table and actual file inode. */
export function writableTrustKeyAliases(mounts: readonly TrustMountPath[], selected: TrustMountPath, keyPath: string): string[] {
  const inSelected = path.posix.relative(selected.target, keyPath);
  if (path.posix.isAbsolute(inSelected) || inSelected === '..' || inSelected.startsWith('../')) {
    throw new Error('ONLINE_TRUST_KEY_OUTSIDE_SELECTED_MOUNT');
  }
  const underlyingKey = path.posix.join(selected.root, inSelected);
  return mounts.filter(mount => mount.device === selected.device && mount.options.includes('rw')).flatMap(mount => {
    const relative = path.posix.relative(mount.root, underlyingKey);
    if (path.posix.isAbsolute(relative) || relative === '..' || relative.startsWith('../')) return [];
    return [path.posix.join(mount.target, relative)];
  });
}
