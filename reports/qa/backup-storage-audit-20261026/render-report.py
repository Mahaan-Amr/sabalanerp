"""Render a human-readable storage decision report from actual metadata receipts."""
import csv
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime

p=pathlib.Path(__file__).resolve().parent
inventory=json.loads((p/'INVENTORY.json').read_text(encoding='utf-8'))
deep=json.loads((p/'DEEP-INVENTORY.json').read_text(encoding='utf-8'))
GiB=1024**3
def size(n):return f'{n/GiB:.2f} GiB'
def usage(root,path):
    return next(row['allocatedBytes'] for group in inventory['usage'] if group['root']==root for row in group['rows'] if row['path']==path)
def volume_size(v):return next(row['allocatedBytes'] for row in v['usage']['rows'] if row['path']==v['mountpoint'])
volumes=[v for v in deep['volumes'] if (v.get('labels') or {}).get('com.docker.compose.project')=='fintech-lab']
volume_total=sum(volume_size(v) for v in volumes)
docker_rows=inventory['dockerStore']['usage']['rows']
docker_total=next(x['allocatedBytes'] for x in docker_rows if x['path']=='/var/lib/docker')
docker_volumes=next(x['allocatedBytes'] for x in docker_rows if x['path']=='/var/lib/docker/volumes')
fs=inventory['filesystem']
used=fs['totalBytes']-fs['freeBytes']
apt_names={'/var/cache/apt/pkgcache.bin','/var/cache/apt/srcpkgcache.bin'}
apt_files=[x for x in inventory['largeFilesOutsideProtectedTrees'] if x['path'] in apt_names]
assert len(apt_files)==2
apt_bytes=sum(x['allocatedBytes'] for x in apt_files)
entries=[
 ('بکاپ‌ها و imageهای recovery سبلان','/srv/sabalanerp-recovery/checkpoints',usage('/srv/sabalanerp-recovery','/srv/sabalanerp-recovery/checkpoints'),'محافظت‌شده؛ planner فعلی حذف مجاز ندارد'),
 ('داده و بکاپ‌های volume پروژهٔ Fintech','Docker volumes: fintech-lab_*',volume_total,'۸ volume به containerهای متوقف متصل‌اند؛ نیاز نگه‌داری باید تعیین شود'),
 ('سایر مصرف Docker','/var/lib/docker (excluding volumes)',docker_total-docker_volumes,'شامل لایه‌های مشترک؛ اندازهٔ imageها نباید با هم جمع شود'),
 ('شواهد و فایل‌های خصوصی recovery سبلان','/root/sabalan-recovery-private',usage('/root','/root/sabalan-recovery-private'),'hold/incident/authority references؛ حذف هنوز مجاز نیست'),
 ('نسخه‌ها و آزمایش‌های Fintech','/opt/fintech-deploy',usage('/opt','/opt/fintech-deploy'),'نیاز نگه‌داری و مرجع bind mount باید تعیین شود'),
 ('لاگ‌های سیستم','/var/log',usage('/var/log','/var/log'),'قابل بررسی برای retention؛ حذف خودکار انجام نشده'),
 ('cacheهای npm','/root/.npm',usage('/root','/root/.npm'),'کاندید بررسی پس از احراز عدم استفادهٔ build/فرایند فعال'),
 ('cache دو index اصلی APT','/var/cache/apt/{pkgcache,srcpkgcache}.bin',apt_bytes,'اندازهٔ تازهٔ metadata؛ فرایند unattended-upgr فعلاً مشاهده شد'),
 ('فایل‌های نصب سیستم','/usr',usage('/','/usr'),'پاک‌سازی دستی پیشنهاد نمی‌شود'),
 ('بسته‌های Snap','/var/lib/snapd',next(x['allocatedBytes'] for group in deep['extraUsage'] if group['root']=='/var/lib' for x in group['rows'] if x['path']=='/var/lib/snapd'),'نسخهٔ فعال/قدیمی باید از طریق manager مشخص شود'),
]
with (p/'SPACE-BREAKDOWN.csv').open('w',encoding='utf-8-sig',newline='') as out:
    writer=csv.writer(out);writer.writerow(['category','path','allocatedBytes','GiB','status'])
    for title,path,amount,state in entries:writer.writerow([title,path,amount,f'{amount/GiB:.4f}',state])
lines=['# گزارش واقعی مصرف فضای سرور بکاپ — بدون حذف', '',
 'مشاهدهٔ زنده در ۲۰۲۶-۱۰-۲۶ انجام شد. filesystem و volumeها از طریق SSH احراز‌شده و قفل انحصاری موجود، فقط‌خواندنی بررسی شدند. هیچ cleanup، prune، resize، تغییر سرویس یا اجرای مرحلهٔ FULL انجام نشد.', '',
 '## نمای دیسک', '',
 f'- مقصد: `/dev/vda1`، ext4 روی `/`؛ بکاپ‌ها در `/srv/sabalanerp-recovery/checkpoints` روی همین filesystem هستند.',
 f'- اندازهٔ filesystem: **{size(fs["totalBytes"])}** ({fs["totalBytes"]:,} بایت).',
 f'- مصرف‌شده طبق statvfs: **{size(used)}** ({used:,} بایت).',
 f'- فضای قابل استفاده در پایان اسکن دوم: **{size(deep["availableBytesAfter"])}** ({deep["availableBytesAfter"]:,} بایت).',
 f'- تفاوت free و available، شامل بلوک‌های رزروشدهٔ filesystem: **{size(fs["filesystemReservedBytes"])}**؛ دست‌نخورده است.', '',
 'حجم‌ها allocated bytes هستند، نه جمع اندازهٔ ظاهری فایل‌ها. جدول دسته‌بندی، مجوز حذف یا تضمین فضای قابل‌بازپس‌گیری نیست. اندازه‌های درخت‌های جدا ممکن است شامل hardlink مشترک باشند؛ پیش از هر حذف، حساب inode/ref مستقل لازم است.', '',
 '## چه چیزی فضا را گرفته است؟', '',
 '| دسته | مسیر | حجم | وضعیت |','|---|---|---:|---|']
for title,path,amount,state in entries:lines.append(f'| {title} | `{path}` | {size(amount)} | {state} |')
lines += ['', '## بزرگ‌ترین یافته: Fintech روی سرور بکاپ', '',
 f'هر **۱۷ container** مشاهده‌شده متعلق به `fintech-lab` و متوقف هستند. هر **۸ volume نام‌دار** این پروژه جمعاً **{size(volume_total)}** گرفته‌اند. توقف container به معنی بی‌نیازی از داده نیست. این volumeها هنوز به همان containerها متصل‌اند.', '',
 '| volume | حجم | اتصال فعلی |','|---|---:|---|']
for v in sorted(volumes,key=volume_size,reverse=True):
    refs=', '.join(sorted({x['service'] for x in v['references']}))
    lines.append(f'| `{v["name"]}` | {size(volume_size(v))} | {refs}؛ همگی متوقف |')
lines += ['',f'فایل‌های `/opt/fintech-deploy` نیز **{size(usage("/opt","/opt/fintech-deploy"))}** هستند. همراه volumeها، حدود **{size(volume_total+usage("/opt","/opt/fintech-deploy"))}** از footprint مسیرهای Fintech است؛ imageهای مشترک Docker جدا هستند. این جمع، فضای قابل حذف قطعی نیست.', '',
 'موارد بزرگ در پوشهٔ deploy:', '',
 '| مسیر | حجم تخصیص‌یافته |','|---|---:|']
for row in sorted(next(x['rows'] for x in inventory['usage'] if x['root']=='/opt'),key=lambda x:x['allocatedBytes'],reverse=True):
    if row['path'] not in ['/opt','/opt/fintech-deploy'] and row['allocatedBytes']>=100*1024**2:
        lines.append(f'| `{row["path"]}` | {size(row["allocatedBytes"])} |')
lines += ['', '## بکاپ‌ها و holdهای سبلان', '',
 '۷ مسیر release و imageهای recovery و یک private transfer حجم اصلی این بخش‌اند. plannerهای قبلی فهرست حذف خالی داشتند؛ snapshot محافظت تازه نیز هیچ image/container قابل حذف نداد. این بررسی مجوز حذف checkpoint، cipher، انتقال شکست‌خورده یا incident hold تولید نکرد.', '',
 '| مسیر | حجم |','|---|---:|']
for row in sorted(next(x['rows'] for x in inventory['usage'] if x['root']=='/srv/sabalanerp-recovery'),key=lambda x:x['allocatedBytes'],reverse=True):
    if row['path'] not in ['/srv/sabalanerp-recovery','/srv/sabalanerp-recovery/checkpoints']:
        lines.append(f'| `{row["path"]}` | {size(row["allocatedBytes"])} |')
lines += ['', 'موارد خصوصی بزرگ:', '', '| مسیر | حجم |','|---|---:|']
for row in next(x['rows'] for x in inventory['usage'] if x['root']=='/root'):
    if row['path'].startswith('/root/sabalan-recovery-private/') and row['allocatedBytes']>100*1024**2:
        lines.append(f'| `{row["path"]}` | {size(row["allocatedBytes"])} |')
lines += ['', '## لاگ و cache؛ گزینه‌های کوچک‌تر برای تصمیم', '',
 f'- journal سیستم: **{size(sum(x["allocatedBytes"] for x in deep["journalFiles"]))}**؛ از این مقدار **{size(sum(x["allocatedBytes"] for x in deep["journalFiles"] if x["archived"]))}** فایل archived است. قدیمی‌ترین mtime مشاهده‌شده مربوط به ۲۰۲۶-۱۰-۱۸ است. retention موردنیاز عیب‌یابی/امنیتی باید پیش از vacuum مشخص شود.',
 '- فایل‌های log بررسی‌شده فقط از روی metadata اندازه‌گیری شدند؛ محتوای احراز هویت یا log خوانده نشد.', '',
 '| فایل log | حجم |','|---|---:|']
for row in sorted(deep['logFiles'],key=lambda x:x['allocatedBytes'],reverse=True):lines.append(f'| `{row["path"]}` | {row["allocatedBytes"]/1024**2:.1f} MiB |')
lines += ['',
 f'- npm cache و npx: **{size(usage("/root","/root/.npm"))}**؛ در مشاهدهٔ فرایندها npm/npx فعال دیده نشد. برای تصمیم حذف باید وابستگی به اجرای offline/بازسازی هم لحاظ شود.',
 f'- APT: دو فایل index در مشاهدهٔ تازه جمعاً {apt_bytes/1024**2:.1f}MiB بودند. فرایند `unattended-upgr` دیده شد؛ این به‌تنهایی اثبات write فعال نیست، ولی quiescence و lockها پیش از حذف باید بررسی شوند.',
 '- دو volume بی‌نام بدون reference، هرکدام فقط۴KiB هستند؛ حذفشان راه‌حل ظرفیت نیست.', '',
 '## مواردی که نباید اشتباه تفسیر شوند', '',
 f'- ۵۳ image inspectشده جمع ظاهری حدود {size(sum(x["bytes"] for x in inventory["images"]))} دارند؛ این مقدار فضای واقعی جداگانه نیست. لایه‌ها مشترک‌اند. کل Docker روی دیسک **{size(docker_total)}** است که بخش عمده‌اش volumeهای داده است.',
 '- فایل حذف‌شدهٔ باز در snapshot دیده نشد؛ اسکن `/proc` یک خطا داشت و فقط مشاهدهٔ نقطه‌ای است، نه تضمین نبود هر reference.',
 '- دادهٔ Fintech خارج از سیاست cleanup سبلان است؛ به همین دلیل خالی‌بودن planner سبلان به معنی نبود گزینهٔ انسانی برای بازنشسته‌کردن پروژهٔ دیگر نیست.',
 '- توقف container یا قدمت نام پوشه، اثبات امن‌بودن حذف نیست. آرشیو، backup، ownership، reference و تصمیم نگه‌داری باید جدا بررسی شوند.', '',
 '## پیشنهاد تصمیم بعدی', '',
 'ابتدا تعیین کنید آیا داده‌ها و آزمایش‌های قدیمی `fintech-lab` همچنان لازم‌اند. این بزرگ‌ترین گروه قابل بررسی است. اگر نگه‌داری لازم است، حذف آن‌ها پیشنهاد نمی‌شود؛ اگر بخشی بازنشسته شده، فهرست دقیق همان بخش، وابستگی‌ها و فضای قابل‌بازپس‌گیری را پیش از هر اقدام آماده می‌کنیم.', '',
 'برای پاک‌سازی محدودتر، retention لاگ‌های archived و نیاز cacheهای npm/APT را مشخص می‌کنیم. هیچ تضمینی داده نمی‌شود که فقط این گزینه‌های کوچک کل بودجهٔ FULL/image را پوشش دهند؛ پس از تصمیم و اجرای مجاز، فضای واقعی دوباره اندازه‌گیری می‌شود.', '',
 'هیچ حذف یا افزایش ظرفیت در این بررسی انجام نشد. اعتبار FULL/#419 از این گزارش حاصل نمی‌شود. هر دو lease مشاهده بسته و فایل موقت رمز بازنشسته شدند؛ داده‌های کسب‌وکار/کلید خصوصی/رمز در گزارش نیامده‌اند.', '',
 '## شواهد', '',
 '- `INVENTORY.json`: اندازه‌ها، referenceها و snapshot محافظت در بررسی نخست.',
 '- `DEEP-INVENTORY.json`: volumeها، اتصال به containerها، logها و جزئیات دوم.',
 '- `SPACE-BREAKDOWN.csv`: جدول اندازه‌های دقیق بر حسب بایت.',
 '- Receipt نخست: `BACKUP-FILESYSTEM-7492f0d684be4d93dd18bf43c5089202.json` در worktree #419.',
 '- Receipt دوم: `BACKUP-DEEP-a1144b0b01d3e61e1b1f1de069e9b585.json` در worktree #419.',
 '- زمان مشاهدهٔ دوم: ۲۰۲۶-۱۰-۲۶، ۲۰:۱۱ به وقت تهران (16:41 UTC).', '']
(p/'REPORT.fa.md').write_text('\n'.join(lines),encoding='utf-8')
r=p.parents[2]
cp=json.loads((r/'reports/qa/update-restore-completion-plan-20261025/CHECKPOINT.json').read_text(encoding='utf-8'))
digest=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git','-C',str(r),*args])
preservation={'stagedPatchSha256':digest(git('diff','--cached','--binary')),'trackedPycSha256':digest(pathlib.Path(cp['trackedPyc']['file']).read_bytes()),'stashHead':git('rev-parse','refs/stash').decode().strip(),'deletionPerformed':False,'resizePerformed':False}
assert preservation['stagedPatchSha256']==cp['stagedPatchSha256']
assert preservation['trackedPycSha256']==cp['trackedPyc']['sha256']
assert preservation['stashHead']==cp['stashHead']
(p/'PRESERVATION.json').write_text(json.dumps(preservation,indent=2)+'\n',encoding='utf-8')
manifest={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(p.iterdir()) if f.is_file() and f.name!='MANIFEST.json'}
(p/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'filesystemGiB':fs['totalBytes']/GiB,'usedGiB':used/GiB,'availableGiB':deep['availableBytesAfter']/GiB,'reservedGiB':fs['filesystemReservedBytes']/GiB,'fintechVolumesGiB':volume_total/GiB,'fintechDeployGiB':usage('/opt','/opt/fintech-deploy')/GiB,'combinedFintechAllocatedGiB':(volume_total+usage('/opt','/opt/fintech-deploy'))/GiB,'backupGiB':usage('/srv/sabalanerp-recovery','/srv/sabalanerp-recovery/checkpoints')/GiB,'report':str(p/'REPORT.fa.md')}))
