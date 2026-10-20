'use strict';
// Read-only inventory; uses Node already present in both existing images.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = process.argv[1];
assert.equal(fs.realpathSync(root), root);
let bytes = 0, pathBytes = 0;
const entries = [];
const identity = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs, value.mode];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function visit(directory) {
  const before = fs.lstatSync(directory, { bigint: true });
  assert.ok(before.isDirectory());
  const children = [];
  const scan = fs.opendirSync(directory);
  try {
    for (let entry; (entry = scan.readSync()) !== null;) {
      assert.ok(children.length + entries.length < 100000);
      children.push(entry.name);
    }
  } finally { scan.closeSync(); }
  children.sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)));
  for (const name of children) {
    const file = path.join(directory,name), relative = path.relative(root,file);
    pathBytes += Buffer.byteLength(relative);
    assert.ok(entries.length < 100000 && Buffer.byteLength(relative) <= 8192 && pathBytes <= 32*1024**2);
    const initial = fs.lstatSync(file,{bigint:true});
    assert.equal(initial.uid,0n);
    if (initial.isSymbolicLink()) {
      const resolved = fs.realpathSync(file);
      assert.ok(resolved === root || resolved.startsWith(root + '/'),'DEPENDENCY_LINK_ESCAPE');
      entries.push([relative,'link',fs.readlinkSync(file)]);
    } else if (initial.isDirectory()) {
      entries.push([relative,'directory']);visit(file);
    } else {
      assert.ok(initial.isFile());
      bytes += Number(initial.size);assert.ok(bytes <= 2*1024**3);
      const fd = fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW), digest = crypto.createHash('sha256');
      try {
        assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(initial));
        let remaining = Number(initial.size);const buffer = Buffer.alloc(262144);
        while (remaining) {const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,remaining),null);assert.ok(count>0);digest.update(buffer.subarray(0,count));remaining-=count;}
        assert.equal(fs.readSync(fd,buffer,0,1,null),0);
        assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(initial));
      } finally {fs.closeSync(fd);}
      entries.push([relative,'file',Number(initial.size),digest.digest('hex'),Number(initial.mode & 0o111n)]);
    }
    assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),identity(initial));
  }
  const after=fs.lstatSync(directory,{bigint:true});
  assert.deepEqual([before.dev,before.ino,before.mtimeNs,before.ctimeNs],[after.dev,after.ino,after.mtimeNs,after.ctimeNs]);
}
visit(root);
console.log(JSON.stringify({entries:entries.length,bytes,inventorySha256:hash(Buffer.from(JSON.stringify(entries)))}));
