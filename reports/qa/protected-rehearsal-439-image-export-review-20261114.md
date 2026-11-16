# #439 retained production image archive review — 2026-11-14

The six exact currently running production image archives are held under `D:\sabalanerp-439-current-images`. The export receipt is `proof.json` (`sabalan-439-image-export/v1`, `productionAdmission:false`). At review, D: had 168,241,610,752 bytes free. The directory, receipt, and every archive carry the NTFS EFS encrypted attribute. EFS protects this Windows staging set, not the QA WSL `ext4.vhdx` or future Docker layers.

An independent read-only review recomputed the full SHA-256 and byte count of every archive. It parsed tar checksums and OCI index, checked the Linux/amd64 manifest and configuration chain, verified every content-addressed blob and decompressed layer diff ID, and compared the source container census before and after each export. All checks passed:

| Service | Bytes | Archive SHA-256 |
| --- | ---: | --- |
| backend | 540681216 | `f6df5640dd5a7516065cccb298783f12c03ae4887ce4def9847686870fe7140a` |
| frontend | 270992384 | `0002f9b8e4e56807c4f2bf9aa04909ce6f1cdaf9bff3c31701b3a713d50205f6` |
| inquiry | 381032960 | `9295729a0bfc6cd89fb70167349223e8c68971725c038c4cb74a07f467a9b203` |
| postgres | 109844992 | `9f00be6321003c4ed7b687aa02ef67e55f7f67d5992a1a01374635c97f837188` |
| clamav | 155089408 | `b0ce6ba3247aa79d3de44d226ba07bbcb74771b5270c92e8ce657485537c1c69` |
| nginx | 21896192 | `a73cfa80cac70d5ae7bf2f504ffa7cd6aee4276ec2a3fdd52597da3577afad02` |

The total is 1,479,537,152 bytes. This clears archive integrity and immutable source identity for a later controlled QA import. It does not prove image-layer content is free of secrets. Docker import writes outside EFS into the D:-backed WSL VHDX, whose volume encryption is unverified; host access and key custody must be reviewed at that boundary. No image was imported, no checkpoint or key was copied, and no QA service or database was started by this review.

The #432 complete rehearsal and production release remain **NO-GO**. The QA ClamAV image requires direct network egress, while the current WSL QA bridge has no isolated outbound path; modifying the shared Docker Desktop network rules is not qualified. The QA backup distro is on the same physical PC and cannot establish independent remote backup custody. The existing external backup host lacks capacity for two protected QA checkpoints, and the owner declined any W: write. The original six local services and production were not changed by the archive review.
