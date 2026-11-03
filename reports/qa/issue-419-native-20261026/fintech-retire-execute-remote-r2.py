"""Explicit user-authorized Fintech retirement on the pinned backup host only."""
import base64,fcntl,hashlib,json,os,pathlib,re,shlex,shutil,stat,subprocess,time,uuid
PLAN=json.loads(base64.b64decode('eyJtYWNoaW5lVXVpZFNoYTI1NiI6IjYzMThiYWRjNTc0MzU2MmMzOTA3MzA1NGQ5OTQxZTdjMmE0ZTZjY2MwNWMzZDUzYTlhNmVkNzA2N2JkMTZlMzgiLCJzYWJhbGFuUmVmZXJlbmNlTWF0Y2hlcyI6W10sInBhdGhzIjpbeyJwYXRoIjoiL2V0Yy9maW50ZWNoLXByb3h5IiwiZGV2Ijo2NDUxMywiaW5vIjoyODEyODYsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL2ZpbnRlY2gtcHJveHkifSx7InBhdGgiOiIvZXRjL2ZpbnRlY2gtd2ViIiwiZGV2Ijo2NDUxMywiaW5vIjoyOTc2MzQsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL2ZpbnRlY2gtd2ViIn0seyJwYXRoIjoiL2V0Yy9uZ2lueC9zaXRlcy1hdmFpbGFibGUvZmludGVjaC1sYWIiLCJkZXYiOjY0NTEzLCJpbm8iOjY2NjY4NywidWlkIjowLCJyZWFscGF0aCI6Ii9ldGMvbmdpbngvc2l0ZXMtYXZhaWxhYmxlL2ZpbnRlY2gtbGFiIn0seyJwYXRoIjoiL2V0Yy9uZ2lueC9zaXRlcy1lbmFibGVkL2ZpbnRlY2gtbGFiIiwiZGV2Ijo2NDUxMywiaW5vIjo2NjgyNTUsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL25naW54L3NpdGVzLWF2YWlsYWJsZS9maW50ZWNoLWxhYiJ9LHsicGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS1iYWNrZW5kQC5zZXJ2aWNlIiwiZGV2Ijo2NDUxMywiaW5vIjoxMzMxMTUsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHktYmFja2VuZEAuc2VydmljZSJ9LHsicGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS1yb3V0aW5nLnNlcnZpY2UiLCJkZXYiOjY0NTEzLCJpbm8iOjE0ODQ2MiwidWlkIjowLCJyZWFscGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS1yb3V0aW5nLnNlcnZpY2UifSx7InBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHktd2F0Y2guc2VydmljZSIsImRldiI6NjQ1MTMsImlubyI6MjEwMjI3LCJ1aWQiOjAsInJlYWxwYXRoIjoiL2V0Yy9zeXN0ZW1kL3N5c3RlbS9maW50ZWNoLXByb3h5LXdhdGNoLnNlcnZpY2UifSx7InBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHktd2F0Y2guc2VydmljZS5kIiwiZGV2Ijo2NDUxMywiaW5vIjoyOTkzNzcsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHktd2F0Y2guc2VydmljZS5kIn0seyJwYXRoIjoiL2V0Yy9zeXN0ZW1kL3N5c3RlbS9maW50ZWNoLXByb3h5LXdhdGNoLnRpbWVyIiwiZGV2Ijo2NDUxMywiaW5vIjoyMTAyNDgsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHktd2F0Y2gudGltZXIifSx7InBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHktd2F0Y2gudGltZXIuZCIsImRldiI6NjQ1MTMsImlubyI6Mjk5MzI0LCJ1aWQiOjAsInJlYWxwYXRoIjoiL2V0Yy9zeXN0ZW1kL3N5c3RlbS9maW50ZWNoLXByb3h5LXdhdGNoLnRpbWVyLmQifSx7InBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHkuc2VydmljZSIsImRldiI6NjQ1MTMsImlubyI6MTMyODc4LCJ1aWQiOjAsInJlYWxwYXRoIjoiL2V0Yy9zeXN0ZW1kL3N5c3RlbS9maW50ZWNoLXByb3h5LnNlcnZpY2UifSx7InBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHkuc2VydmljZS5kIiwiZGV2Ijo2NDUxMywiaW5vIjoyOTk0MDAsInVpZCI6MCwicmVhbHBhdGgiOiIvZXRjL3N5c3RlbWQvc3lzdGVtL2ZpbnRlY2gtcHJveHkuc2VydmljZS5kIn0seyJwYXRoIjoiL29wdC9maW50ZWNoLWRlcGxveSIsImRldiI6NjQ1MTMsImlubyI6MjYyMTQ2LCJ1aWQiOjAsInJlYWxwYXRoIjoiL29wdC9maW50ZWNoLWRlcGxveSJ9LHsicGF0aCI6Ii9vcHQvZmludGVjaC1sYWIiLCJkZXYiOjY0NTEzLCJpbm8iOjI5NzUyOCwidWlkIjowLCJyZWFscGF0aCI6Ii9vcHQvZmludGVjaC1sYWIifSx7InBhdGgiOiIvcm9vdC9maW50ZWNoLWFjY2Vzcy5qc29uIiwiZGV2Ijo2NDUxMywiaW5vIjo4Mjg1LCJ1aWQiOjAsInJlYWxwYXRoIjoiL3Jvb3QvZmludGVjaC1hY2Nlc3MuanNvbiJ9LHsicGF0aCI6Ii91c3IvbG9jYWwvYmluL2ZpbnRlY2gteHJheSIsImRldiI6NjQ1MTMsImlubyI6MjEwMTkwLCJ1aWQiOjAsInJlYWxwYXRoIjoiL3Vzci9sb2NhbC9iaW4vZmludGVjaC14cmF5In1dLCJ2b2x1bWVzIjpbeyJuYW1lIjoiZmludGVjaC1sYWJfbGFiLWJhY2t1cHMiLCJkcml2ZXIiOiJsb2NhbCIsIm1vdW50cG9pbnQiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItYmFja3Vwcy9fZGF0YSIsInJvb3QiOnsicGF0aCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1iYWNrdXBzL19kYXRhIiwicmVhbHBhdGgiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItYmFja3Vwcy9fZGF0YSIsImRldiI6NjQ1MTMsImlubyI6NjY5MTQ3LCJ1aWQiOjEwMDAxLCJnaWQiOjEwMDAxLCJtb2RlIjo0OTMsInNpemUiOjQwOTYsIm5saW5rIjoyNCwic3ltbGluayI6ZmFsc2UsImRpcmVjdG9yeSI6dHJ1ZX19LHsibmFtZSI6ImZpbnRlY2gtbGFiX2xhYi1jb3N0LWJhY2t1cHMiLCJkcml2ZXIiOiJsb2NhbCIsIm1vdW50cG9pbnQiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItY29zdC1iYWNrdXBzL19kYXRhIiwicm9vdCI6eyJwYXRoIjoiL3Zhci9saWIvZG9ja2VyL3ZvbHVtZXMvZmludGVjaC1sYWJfbGFiLWNvc3QtYmFja3Vwcy9fZGF0YSIsInJlYWxwYXRoIjoiL3Zhci9saWIvZG9ja2VyL3ZvbHVtZXMvZmludGVjaC1sYWJfbGFiLWNvc3QtYmFja3Vwcy9fZGF0YSIsImRldiI6NjQ1MTMsImlubyI6Njc1Mzg1LCJ1aWQiOjEwMDAxLCJnaWQiOjEwMDAxLCJtb2RlIjo0OTMsInNpemUiOjQwOTYsIm5saW5rIjozLCJzeW1saW5rIjpmYWxzZSwiZGlyZWN0b3J5Ijp0cnVlfX0seyJuYW1lIjoiZmludGVjaC1sYWJfbGFiLWNvc3QtZGF0YSIsImRyaXZlciI6ImxvY2FsIiwibW91bnRwb2ludCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1jb3N0LWRhdGEvX2RhdGEiLCJyb290Ijp7InBhdGgiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItY29zdC1kYXRhL19kYXRhIiwicmVhbHBhdGgiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItY29zdC1kYXRhL19kYXRhIiwiZGV2Ijo2NDUxMywiaW5vIjo3MDA5NzgsInVpZCI6MTAwMDEsImdpZCI6MTAwMDEsIm1vZGUiOjQ5Mywic2l6ZSI6NDA5NiwibmxpbmsiOjMsInN5bWxpbmsiOmZhbHNlLCJkaXJlY3RvcnkiOnRydWV9fSx7Im5hbWUiOiJmaW50ZWNoLWxhYl9sYWItZGF0YSIsImRyaXZlciI6ImxvY2FsIiwibW91bnRwb2ludCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1kYXRhL19kYXRhIiwicm9vdCI6eyJwYXRoIjoiL3Zhci9saWIvZG9ja2VyL3ZvbHVtZXMvZmludGVjaC1sYWJfbGFiLWRhdGEvX2RhdGEiLCJyZWFscGF0aCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1kYXRhL19kYXRhIiwiZGV2Ijo2NDUxMywiaW5vIjo2NjkxNDQsInVpZCI6MTAwMDEsImdpZCI6MTAwMDEsIm1vZGUiOjQ5Mywic2l6ZSI6MTYzODQsIm5saW5rIjo5LCJzeW1saW5rIjpmYWxzZSwiZGlyZWN0b3J5Ijp0cnVlfX0seyJuYW1lIjoiZmludGVjaC1sYWJfbGFiLXBhLWNvbnRleHQtYmFja3VwcyIsImRyaXZlciI6ImxvY2FsIiwibW91bnRwb2ludCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1wYS1jb250ZXh0LWJhY2t1cHMvX2RhdGEiLCJyb290Ijp7InBhdGgiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItcGEtY29udGV4dC1iYWNrdXBzL19kYXRhIiwicmVhbHBhdGgiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItcGEtY29udGV4dC1iYWNrdXBzL19kYXRhIiwiZGV2Ijo2NDUxMywiaW5vIjo3MDE4NTUsInVpZCI6MTAwMDEsImdpZCI6MTAwMDEsIm1vZGUiOjQ5Mywic2l6ZSI6NDA5NiwibmxpbmsiOjMsInN5bWxpbmsiOmZhbHNlLCJkaXJlY3RvcnkiOnRydWV9fSx7Im5hbWUiOiJmaW50ZWNoLWxhYl9sYWItcGEtY29udGV4dC1kYXRhIiwiZHJpdmVyIjoibG9jYWwiLCJtb3VudHBvaW50IjoiL3Zhci9saWIvZG9ja2VyL3ZvbHVtZXMvZmludGVjaC1sYWJfbGFiLXBhLWNvbnRleHQtZGF0YS9fZGF0YSIsInJvb3QiOnsicGF0aCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1wYS1jb250ZXh0LWRhdGEvX2RhdGEiLCJyZWFscGF0aCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1wYS1jb250ZXh0LWRhdGEvX2RhdGEiLCJkZXYiOjY0NTEzLCJpbm8iOjcwMTc2MSwidWlkIjoxMDAwMSwiZ2lkIjoxMDAwMSwibW9kZSI6NDkzLCJzaXplIjo0MDk2LCJubGluayI6Mywic3ltbGluayI6ZmFsc2UsImRpcmVjdG9yeSI6dHJ1ZX19LHsibmFtZSI6ImZpbnRlY2gtbGFiX2xhYi1wYXlvZmYtYmFja3VwcyIsImRyaXZlciI6ImxvY2FsIiwibW91bnRwb2ludCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1wYXlvZmYtYmFja3Vwcy9fZGF0YSIsInJvb3QiOnsicGF0aCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1wYXlvZmYtYmFja3Vwcy9fZGF0YSIsInJlYWxwYXRoIjoiL3Zhci9saWIvZG9ja2VyL3ZvbHVtZXMvZmludGVjaC1sYWJfbGFiLXBheW9mZi1iYWNrdXBzL19kYXRhIiwiZGV2Ijo2NDUxMywiaW5vIjo3OTEzMjYsInVpZCI6MTAwMDEsImdpZCI6MTAwMDEsIm1vZGUiOjQ5Mywic2l6ZSI6NDA5NiwibmxpbmsiOjMsInN5bWxpbmsiOmZhbHNlLCJkaXJlY3RvcnkiOnRydWV9fSx7Im5hbWUiOiJmaW50ZWNoLWxhYl9sYWItcGF5b2ZmLWRhdGEiLCJkcml2ZXIiOiJsb2NhbCIsIm1vdW50cG9pbnQiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItcGF5b2ZmLWRhdGEvX2RhdGEiLCJyb290Ijp7InBhdGgiOiIvdmFyL2xpYi9kb2NrZXIvdm9sdW1lcy9maW50ZWNoLWxhYl9sYWItcGF5b2ZmLWRhdGEvX2RhdGEiLCJyZWFscGF0aCI6Ii92YXIvbGliL2RvY2tlci92b2x1bWVzL2ZpbnRlY2gtbGFiX2xhYi1wYXlvZmYtZGF0YS9fZGF0YSIsImRldiI6NjQ1MTMsImlubyI6NzkxMzI0LCJ1aWQiOjEwMDAxLCJnaWQiOjEwMDAxLCJtb2RlIjo0OTMsInNpemUiOjQwOTYsIm5saW5rIjozLCJzeW1saW5rIjpmYWxzZSwiZGlyZWN0b3J5Ijp0cnVlfX1dLCJpbWFnZXMiOlt7ImlkIjoic2hhMjU2OjA2MmJlZWJiNWU3ZGM5MGNkODg0NjIzM2ZhYWJkMzJkZDM2OTA2OGE1NmE4OTg4YTZlZTMyN2UyZTAwNWYyNzEiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOm1hY3JvLWNhbGVuZGFyLXJlc2VhcmNoLTIwMjYxMDE1Il19LHsiaWQiOiJzaGEyNTY6MGMzOTc1NTZhZTliOTZmNWNjODY4M2JkOWVjYzQ4NmU5ZTQ3MWY0MWM0ZTYzOGQ4MWIzZjExM2E0MDUwYjgyZiIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6cGF5b2ZmLWRpc3RyaWJ1dGlvbi1yZXBsYXktdjEiXX0seyJpZCI6InNoYTI1NjoxNmI1OWNiZDYxNGIzZDUzMzg2MmQ3NGZkOTlhYjc0NGNjNTQ3YjU1ZjVkYzgxYjMxYjNmYTZiYWVlOTJjMzk5Iiwibm9uRmludGVjaFJlZmVyZW5jZXMiOltdLCJvdGhlclRhZ3MiOltdLCJmaW50ZWNoVGFncyI6WyJmaW50ZWNoLWxhYjpoaXN0b3JpY2FsLWZpeC1iYXNlLTIwMjYxMDE3IiwiZmludGVjaC1sYWI6aGlzdG9yaWNhbC12MTEtbmV0d29yay0yMDI2MTAxNSJdfSx7ImlkIjoic2hhMjU2OjFlNTM5MDAxZDJjNzUyMjI4OTk4YWUyMjZjZGYzYjIxOWM4NmEwYTc1ZmE1ZDhmZTI0NmE0NjMyMjE1NzYyYzciLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmh5cG90aGVzZXMtZml4LTIwMjYxMDE3Il19LHsiaWQiOiJzaGEyNTY6MjJhZDA0OTdjMjhkNDQ4NjdjN2U3YTdjNjM0MmJiYjA0NmU5YWZmZThjNTE5ODFmYmY1YWIwOTFhNjMxN2M1NCIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6aGlzdG9yaWNhbC1maXgtMjAyNjEwMTciLCJmaW50ZWNoLWxhYjpyZWxlYXJuaW5nLXYxMi1iYXNlLTIwMjYxMDE3Il19LHsiaWQiOiJzaGEyNTY6MzA4ODEzNWRiZjUxZjkzYTM4M2ZhMjhhMWIyOGYyNWM4MTIyNjc3NDU3ZWYxMDAzMDliNGZjYzEzYjM0MjdjNiIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6YmVmb3JlLXBvb2xlZC12OS0yMDI2MTAxMyIsImZpbnRlY2gtbGFiOnY4LXRyYW5zcG9ydCJdfSx7ImlkIjoic2hhMjU2OjMxNGM3NmJmMTljNDQ2Y2UxYWI5ZTY5NWYyOGE1ZWYxN2YyYWNmMTM5YjM4N2E2NThmMzQyMWUyNzc3MzBkMjEiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS1ldmlkZW5jZS12Ni0yMDI2MTAwOCIsImZpbnRlY2gtbGFiOnVpLWxhZy1jYW5kaWRhdGUiXX0seyJpZCI6InNoYTI1NjozZWZlZDViMzdlOTlmODAxMGI1MmM5OGVkOTg5MTU1MTBjNzlhNjMxZjJjNmMyNTI0ZmRhZDExZDY4MTkyNjg5Iiwibm9uRmludGVjaFJlZmVyZW5jZXMiOltdLCJvdGhlclRhZ3MiOltdLCJmaW50ZWNoVGFncyI6WyJmaW50ZWNoLWxhYjpiZWZvcmUtdjgtdHJhbnNwb3J0LTIwMjYxMDEyIiwiZmludGVjaC1sYWI6a3Jha2VuLXVpIl19LHsiaWQiOiJzaGEyNTY6NDQ0MmMxNDNlMWI2YTZiMmViNDg1ZGFiNTRkYjYyY2U1OWMyOTlhNmIyMGMwMWU2ZTEyZDIzMWFkNmZjZjNhOCIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6YmVmb3JlLWh5cG90aGVzZXMtMjAyNjEwMDciLCJmaW50ZWNoLWxhYjplZGdlLWNhbmRpZGF0ZSJdfSx7ImlkIjoic2hhMjU2OjUwYWRjYTQyNjdlOTVjOWU0OWI3N2MyMDEyMzZjZDhjMTAzOTdiOGVkOGE1Y2EwMDczNDk1NDlkN2RjNDdmNzEiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS1rcmFrZW4tMjAyNjEwMTEiLCJmaW50ZWNoLWxhYjpsZWFybmluZzctY2FuZGlkYXRlIl19LHsiaWQiOiJzaGEyNTY6NTQwMDUzN2U3OGIzYzRlYjNmMTEwY2I2NWQ1MTNkMjM5MDVmNjY1NDBkYTgxMGQ2MmNmMDNmMjUxYmVkNjE0MiIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6bWFjcm8tY2FsZW5kYXItYmFzZS1kYXNoYm9hcmQtMjAyNjEwMTUiLCJmaW50ZWNoLWxhYjp1aS1yZWRlc2lnbi1ndWFyZDMtMjAyNjEwMTQiXX0seyJpZCI6InNoYTI1Njo1NzljMjU2NzIzZGJmYmRhYWUwMWYzYzAwMzRhM2QzZWJlOWFkNTZmM2ZjZDIyZmEyZjNmNTZmNTBkMTZlNTBhIiwibm9uRmludGVjaFJlZmVyZW5jZXMiOltdLCJvdGhlclRhZ3MiOltdLCJmaW50ZWNoVGFncyI6WyJmaW50ZWNoLWxhYjpkYXNoYm9hcmQtdjEyLWJhc2UtMjAyNjEwMTciLCJmaW50ZWNoLWxhYjpoaXN0b3JpY2FsLXYxMS0yMDI2MTAxNSJdfSx7ImlkIjoic2hhMjU2OjU3ZWIzM2JlNDU3MjQzZWYyNTdkNzQ4YzA4YzNhM2E2ZDVjMzk0YmFiMzEyNzdkNjZkNWJjOWVkMTMwNWRjZmIiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS11aS1zdG9yYWdlLXJlYWRvbmx5LTIwMjYxMDE0IiwiZmludGVjaC1sYWI6dWktcmVkZXNpZ24tZ3VhcmQtMjAyNjEwMTQiXX0seyJpZCI6InNoYTI1Njo2MzgxODhmYjgyZDk0ODczNTZhN2EwNGYyYjA4ZWM5MGU2OTliM2E1OTUzMTk0ODM4Y2EyNWVmMmE3MzJiMjUyIiwibm9uRmludGVjaFJlZmVyZW5jZXMiOltdLCJvdGhlclRhZ3MiOltdLCJmaW50ZWNoVGFncyI6WyJmaW50ZWNoLWxhYjpyZXBsYXktdWktY2xhcmlmaWVkIl19LHsiaWQiOiJzaGEyNTY6NjQ1MWE4ZDM2OWFhM2Q5ZjQ3YzVmNTIyZjhhNDQ4Zjk4ZDM5MDQzYzgzYjgyMjc4MTY2OTMzMzRjZmRkMDM0YiIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6aHlwb3RoZXNlcy1maXgtYmFzZS0yMDI2MTAxNyJdfSx7ImlkIjoic2hhMjU2OjZiZDI4MDQzNzQxNDE3YmVkZTgzY2U0ZDQ4YzEyNDNlMjA3ODVkMmUzMTA2ZmRjMzdjOGI3MDVlOTY1ODA1ZDciLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOnJlbGVhcm5pbmctY2xvY2stYmFzZS0yMDI2MTAxNyIsImZpbnRlY2gtbGFiOnJlbGVhcm5pbmctdjEyLTIwMjYxMDE3Il19LHsiaWQiOiJzaGEyNTY6ODU0MWFmM2Y4MGFiMzgyNzQzNmI5YWY3Zjg5YTViZjA1M2Y2YjZmOWQxMzY5MWM0YTczODJhYmE0NDgyNDA3MyIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOltdfSx7ImlkIjoic2hhMjU2OjhjMzI2ZjM0YjQzMWI3NzFiNGU1YWIwNTFlMjhjNDY1YmM3ZjFjYWExZjU4YjliNTgxNzkyNzg2YjdiMTI5MzUiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS11aS1zdG9yYWdlLWhlYXJ0YmVhdC0yMDI2MTAxNCIsImZpbnRlY2gtbGFiOnVpLXJlZGVzaWduLWd1YXJkMi0yMDI2MTAxNCJdfSx7ImlkIjoic2hhMjU2OjkxN2Q2NTUxYjU3ZjEwNzdiYjdkNDYwYWU2NjZiNWI4NmMyYzBlN2M3NWIwNmFjMGU4ZTM1ZTM1MjhkYTI2NDMiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmNvc3QtYXdhcmUtcGlubmVkLWJhc2UiLCJmaW50ZWNoLWxhYjpoaXN0b3JpY2FsLXJlcGxheS12MS13b3JrZXIiXX0seyJpZCI6InNoYTI1Njo5YmE1YjhlYjliOWU4NzMzYjY1N2JhZGVlNDg5YzgwMGUyMzRkZDAzMDY1MWQ3YTJiMTQ1ODBlZDA3YzM1Y2U1Iiwibm9uRmludGVjaFJlZmVyZW5jZXMiOltdLCJvdGhlclRhZ3MiOltdLCJmaW50ZWNoVGFncyI6WyJmaW50ZWNoLWxhYjpiZWZvcmUtbXVsdGlhc3NldC0yMDI2MTAwNCIsImZpbnRlY2gtbGFiOnNjYWxwLTIwMjYxMDA0Il19LHsiaWQiOiJzaGEyNTY6YTUyZGM1ODg4NzNmYTk4MDFmYjA3YTZiZjhhNjU0ODQ5MTk0YWY0YzdiYjYyNGYzODFmYjYxZWQ1MDAxZjQ1MyIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6Y29zdC1hd2FyZS1yZXBsYXktdjEiLCJmaW50ZWNoLWxhYjpwYS1jb250ZXh0LXBpbm5lZC1iYXNlIl19LHsiaWQiOiJzaGEyNTY6YTY0MmUxM2UxNGU2ZDU5YmFmN2UyZWRmMDNkNGIyYjk1YjAzNTk4Yzg3ZTg2NjA4MmQ0Njk5NzlhOTIzMGVkNiIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6YmVmb3JlLWVkZ2UtMjAyNjEwMDYiLCJmaW50ZWNoLWxhYjpwcm9maXQtY2FuZGlkYXRlIl19LHsiaWQiOiJzaGEyNTY6YTk4OTYwNDJjYTI3ZDdhZWM3ZjU3ZDA4OGRjOTFmZDUyN2M2MzZlNmI5OTMwOTMzMjIyNjUzNGVkYzhmZTI1OCIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6a3Jha2VuLWNhbmRpZGF0ZSJdfSx7ImlkIjoic2hhMjU2OmFkYzM3MTBhMjY3NjMzMzA4YWIxMjcxMDBlMzY2ODg2ZGRmYTk2ZGEyZTM0ZWUyMWJkNDY0ODVkNDIzMGVlYWYiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS11aS1zdG9yYWdlLXdhaXQtMjAyNjEwMTQiLCJmaW50ZWNoLWxhYjp1aS1yZWRlc2lnbi0yMDI2MTAxNCJdfSx7ImlkIjoic2hhMjU2OmIxYjU2M2NjN2M2OGEyNTA5Y2JlZGFlOWMxZmNjYWJjN2Q0YWVhZDQ1MDlmYzgxZjgyZDliYTMyMjNlNjA5YmQiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmhpc3RvcmljYWwtcmVwbGF5LXYxLWRhc2hib2FyZCIsImZpbnRlY2gtbGFiOnJlcGxheS11aS1waW5uZWQtYmFzZSJdfSx7ImlkIjoic2hhMjU2OmIyYjM4MzY2ZTEwNGQ4NmNmYjlmNGI1NTlhYTMxZmZkN2RlMjYwNDRiN2MzOGU1YjNhZWM5YjNmMzAyNjJhNmQiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmFkYXB0aXZlLWNhbmRpZGF0ZSIsImZpbnRlY2gtbGFiOmJlZm9yZS1sZWFybmluZy1saXZlLTIwMjYxMDA1IiwiZmludGVjaC1sYWI6bWFjcm8tY2FsZW5kYXItYmFzZS1yZXNlYXJjaC0yMDI2MTAxNSJdfSx7ImlkIjoic2hhMjU2OmI5OTU5ZTZhYzgzZmVlNGQwNzAyNWUzNzIzMmNhNDU1NWIyYzIyZDYzY2IxMmNjODBkNDE1ZDQzN2FjZDNjZDQiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS1wcm9maXQtMjAyNjEwMDYiLCJmaW50ZWNoLWxhYjpsZWFybmluZy1saXZlLWNhbmRpZGF0ZSJdfSx7ImlkIjoic2hhMjU2OmMwMTBlZTc3Zjc2ZTg3ZTgzZWMyYmQzN2ZlNmFjYTgwYmU4YmYxM2QxOTA2YmQ5NWVjYzFjNGE1MjI5ZGQwMmYiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS11aS1sYWctMjAyNjEwMDgiLCJmaW50ZWNoLWxhYjpoeXBvdGhlc2VzLWNhbmRpZGF0ZSJdfSx7ImlkIjoic2hhMjU2OmM1NDg5YjZkOTgxNjI4NGY5ODNiNjlmOGVjYTYwMTU0ODliODNhOWU5ODM0ZTMyYWIwMjQ3NDFjN2U4NTdlNTgiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS1oaXN0b3JpY2FsLXYxMS0yMDI2MTAxNSIsImZpbnRlY2gtbGFiOm1hY3JvLWNhbGVuZGFyLWRhc2hib2FyZC0yMDI2MTAxNSJdfSx7ImlkIjoic2hhMjU2OmQ0MzM0MWIzNzUyMTFkMWEwMjk0N2Y0YjMxMmUzNmRlOWIwNGZhZDZiY2QxYWY5Y2FiMWM5ZDdlYzcxODY3NDAiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmhpc3RvcmljYWwtcmVwbGF5LXBpbm5lZC1iYXNlLXdvcmtlciIsImZpbnRlY2gtbGFiOnJlbGVhcm5pbmctY2xvY2stZml4LTIwMjYxMDE3Il19LHsiaWQiOiJzaGEyNTY6ZDdlMGExN2I5YWRmNzQ2NDFjNGRlNDlmNmMyNWNmN2Y1ODdmYTBiNTI0MWM3ZjJiNTVkNWZlYWRkZTM0NmY4NSIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6cGEtY29udGV4dC1yZXBsYXktdjEiLCJmaW50ZWNoLWxhYjpwYXlvZmYtYmFzZS0yMDI2MTAxOCJdfSx7ImlkIjoic2hhMjU2OmRlZTgxMGJhM2U4OTY2OTUyNDMzZTFlNTgwNGJjYjA2ZTc3Y2NkYWY2NDM2ZmQ1YTNlNTQ2MjFmYjkyNjk1MTQiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOnBvb2xlZC12MTAtb3BzIl19LHsiaWQiOiJzaGEyNTY6ZGYyMjhjZjQzNmE0ODZjMTJjY2UzYzJjOTQxM2EwZGM0NWI3OTRhOGRkZmE3YTc1M2NiYTA4ZGUzNmUwZTQ3NSIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6YmVmb3JlLWxlYXJuaW5nNy0yMDI2MTAxMSIsImZpbnRlY2gtbGFiOmV2aWRlbmNlLXY2LWNhbmRpZGF0ZSJdfSx7ImlkIjoic2hhMjU2OmUwZjE5ZTIwYWU1ZTY2NzI0MDhmOTJiZmYwM2E3NzNmOTJlMTJjMjRlMmEyMzJkZGY4ZTM0NDQ5YTA2MzM2NmIiLCJub25GaW50ZWNoUmVmZXJlbmNlcyI6W10sIm90aGVyVGFncyI6W10sImZpbnRlY2hUYWdzIjpbImZpbnRlY2gtbGFiOmJlZm9yZS1wb29sZWQtdjEwLTIwMjYxMDE0IiwiZmludGVjaC1sYWI6bG9jYWwiLCJmaW50ZWNoLWxhYjpwb29sZWQtdjktZmluYWwiXX0seyJpZCI6InNoYTI1NjplNGE1YzVlYTRkNDY5YzRhZjY4NTQxN2ZiNjQwMGUxZTliNGQxYWUzNGIxMzg4YTAxODc0YzVmZGI1NzNjNjljIiwibm9uRmludGVjaFJlZmVyZW5jZXMiOltdLCJvdGhlclRhZ3MiOltdLCJmaW50ZWNoVGFncyI6WyJmaW50ZWNoLWxhYjpiZWZvcmUtdWktcmVkZXNpZ24tMjAyNjEwMTQiLCJmaW50ZWNoLWxhYjpwb29sZWQtdjEwIl19LHsiaWQiOiJzaGEyNTY6ZTZhODI0ZTM2YWY1NjFhNDI1N2NhNWI3YzE0Y2E3ODdlNmI3NDI1YTFhZjM5OWNjYmIyMDQ1MGI2YjFmZDQ5ZCIsIm5vbkZpbnRlY2hSZWZlcmVuY2VzIjpbXSwib3RoZXJUYWdzIjpbXSwiZmludGVjaFRhZ3MiOlsiZmludGVjaC1sYWI6ZGFzaGJvYXJkLXYxMi0yMDI2MTAxNyIsImZpbnRlY2gtbGFiOmhpc3RvcmljYWwtcmVwbGF5LXBpbm5lZC1iYXNlLWRhc2hib2FyZCJdfV0sInN5c3RlbWRVbml0cyI6W3sicGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS1iYWNrZW5kQC5zZXJ2aWNlIiwic2hhMjU2IjoiYWUwZDViMDUyNzYzOWYxY2NjNTZmNDYxMzQwM2JjZGVkNTU5NGE0NzMxZWFjYWY2Mjk1MDlkYmUwZjgwNWYyNyJ9LHsicGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS13YXRjaC5zZXJ2aWNlIiwic2hhMjU2IjoiNjJjZWRmOGQxYjMxMjMxZDdkMThlNTIwMWE1YjFiZjM3MjA5OWNjOTFlNmI0NzE3YzFlMzgyNDljMmM2NjJlOSJ9LHsicGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS5zZXJ2aWNlIiwic2hhMjU2IjoiZTVlOWNjZjYzOTJmMGU5YzAwZGUwOTNlN2VlNjc1YTZjZjA3Yzc1ODA2YTk1ZTNhMjRlNDFjOWVhMGE5M2ViMCJ9LHsicGF0aCI6Ii9ldGMvc3lzdGVtZC9zeXN0ZW0vZmludGVjaC1wcm94eS1yb3V0aW5nLnNlcnZpY2UiLCJzaGEyNTYiOiJhM2JhYzk0MDViMzg1MGRjNDNhMzZlMDg4MmE3OTExYmE1Y2E0NjY3Y2JhYTJiNTE0M2IzYzNlM2ZlMjA2OTQ2In1dfQ=='))
assert os.getuid()==0
assert hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest()==PLAN['machineUuidSha256']=='6318badc5743562c39073054d9941e7c2a4e6ccc05c3d53a9a6ed7067bd16e38'
lock='/run/lock/sabalan-backup-storage.lock'
lockfd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
original=os.fstat(lockfd)
assert original.st_uid==0 and original.st_nlink==1 and not original.st_mode&0o022
def locked():
 now=os.stat(lock,follow_symlinks=False)
 assert (now.st_dev,now.st_ino)==(original.st_dev,original.st_ino)
protected='/srv/sabalanerp-recovery/checkpoints'
assert os.path.realpath(protected)==protected
device=os.stat(protected).st_dev
assert device==64513
audit_parent='/var/log/sabalanerp-backup'
assert os.path.realpath(audit_parent)==audit_parent and os.stat(audit_parent).st_uid==0 and not os.stat(audit_parent).st_mode&0o022
audit_file=audit_parent+'/fintech-retirement-'+uuid.uuid4().hex+'.jsonl'
auditfd=os.open(audit_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
events=[]
def event(kind,**value):
 row={'event':kind,**value};raw=(json.dumps(row,separators=(',',':'))+'\n').encode()
 offset=0
 while offset<len(raw):offset+=os.write(auditfd,raw[offset:])
 os.fsync(auditfd);events.append(row)
def command(argv,allowed=(0,)):
 locked();event('COMMAND_INTENT',argv=argv)
 p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 out,err=p.communicate()
 assert len(out)<=8*1024**2 and len(err)<=131072
 event('COMMAND_CLOSED',pid=p.pid,code=p.returncode,stdoutEof=p.stdout.closed,stderrEof=p.stderr.closed,stdoutSha256=hashlib.sha256(out).hexdigest(),stderrSha256=hashlib.sha256(err).hexdigest())
 assert p.returncode in allowed, 'COMMAND_REFUSED:'+argv[0]+':'+str(p.returncode)
 return p.returncode,out
def docker(*argv,allowed=(0,)):
 return command(['docker',*argv],allowed=allowed)
def containers():
 _,raw=docker('ps','--all','--quiet','--no-trunc');ids=raw.decode().splitlines()
 if not ids:return []
 fmt='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"mounts":{{json .Mounts}}}'
 _,raw=docker('inspect','--format',fmt,*ids)
 return [json.loads(x) for x in raw.decode().splitlines()]
projects={'fintech-lab','fintech-qa'}
def protected_snapshot():
 rows=[]
 for base,dirs,files in os.walk(protected,followlinks=False):
  for name in dirs+files:
   p=os.path.join(base,name);s=os.lstat(p)
   row=[p,s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
   if p.endswith('.json') and stat.S_ISREG(s.st_mode) and s.st_size<8*1024**2:row.append(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest())
   rows.append(row)
 return hashlib.sha256(json.dumps(sorted(rows)).encode()).hexdigest(),len(rows)
unit_pattern=re.compile(r'^fintech-proxy(?:-backend@[0-9]+|-routing|-watch)?\.(?:service|timer)$')
allowed_roots={x['path']:x for x in PLAN['paths']}
assert set(allowed_roots)=={'/etc/fintech-proxy','/etc/fintech-web','/etc/nginx/sites-available/fintech-lab','/etc/nginx/sites-enabled/fintech-lab','/etc/systemd/system/fintech-proxy-backend@.service','/etc/systemd/system/fintech-proxy-routing.service','/etc/systemd/system/fintech-proxy-watch.service','/etc/systemd/system/fintech-proxy-watch.service.d','/etc/systemd/system/fintech-proxy-watch.timer','/etc/systemd/system/fintech-proxy-watch.timer.d','/etc/systemd/system/fintech-proxy.service','/etc/systemd/system/fintech-proxy.service.d','/opt/fintech-deploy','/opt/fintech-lab','/root/fintech-access.json','/usr/local/bin/fintech-xray'}
deleted={'containers':[],'volumes':[],'images':[],'paths':[],'networks':[],'units':[],'tags':[]}
before_space=os.statvfs(protected);before_free=before_space.f_bavail*before_space.f_frsize
before_protected=protected_snapshot()
initial=containers();other=[c for c in initial if c['project'] not in projects]
assert not other, 'UNEXPECTED_NON_FINTECH_CONTAINER_CHANGED_SINCE_PLAN'
image_ids={x['id'] for x in PLAN['images']}
assert not PLAN['sabalanReferenceMatches']
baseline_images=set(command(['docker','image','ls','--all','--quiet','--no-trunc'])[1].decode().splitlines())
remaining_before=baseline_images-image_ids
def image_tags(image):
 code,raw=docker('image','inspect','--format','{{json .RepoTags}}',image,allowed=(0,1))
 return None if code else (json.loads(raw) or [])
def non_fintech_tags():
 result={}
 for image in set(docker('image','ls','--all','--quiet','--no-trunc')[1].decode().splitlines()):
  for tag in image_tags(image) or []:
   if not tag.startswith('fintech-lab:'):result[tag]=image
 return result
non_fintech_tags_before=non_fintech_tags()
nginx_state=command(['systemctl','show','nginx','--property=ActiveState','--value'])[1].decode().strip()
status='PARTIAL_FAILED';error=None
try:
 event('RETIREMENT_AUTHORIZED',scope='All Fintech project/data on backup host only',beforeAvailable=before_free,protectedDigest=before_protected[0])
 # Reversibly omit only the Fintech include, validate remaining shared nginx,
 # then restore the same symlink before proceeding with irreversible retirement.
 site='/etc/nginx/sites-enabled/fintech-lab';temporary_link=audit_file+'.nginx-link'
 assert os.path.islink(site) and not os.path.lexists(temporary_link)
 assert os.path.realpath(site)==allowed_roots[site]['realpath']
 os.rename(site,temporary_link)
 try:
  config=command(['nginx','-T'])[1]
  assert not re.search(rb'/(?:opt/fintech(?:-deploy|-lab)|etc/fintech(?:-proxy|-web)|usr/local/bin/fintech-xray)',config), 'SHARED_NGINX_FINTECH_REFERENCE'
 finally:
  assert not os.path.lexists(site)
  os.rename(temporary_link,site)
 for unit in PLAN['systemdUnits']:
  assert hashlib.sha256(pathlib.Path(unit['path']).read_bytes()).hexdigest()==unit['sha256'], 'UNIT_SOURCE_DRIFT'
 # Stop the timer first so the project's own watcher cannot respawn proxies.
 command(['systemctl','disable','--now','fintech-proxy-watch.timer'])
 _,raw=command(['systemctl','list-units','--all','--plain','--no-legend','fintech*'])
 units=[line.split()[0] for line in raw.decode().splitlines() if line.split()]
 assert all(unit_pattern.fullmatch(x) for x in units), 'UNKNOWN_FINTECH_UNIT_REQUIRES_REVIEW'
 ordered=sorted(units,key=lambda x:(0 if x=='fintech-proxy-watch.service' else 1,x))
 for name in ordered:
  command(['systemctl','stop',name])
  command(['systemctl','disable',name])
  props=command(['systemctl','show',name,'--property=ActiveState,MainPID'])[1].decode()
  assert 'MainPID=0' in props or name.endswith('.timer')
  assert 'ActiveState=inactive' in props or 'ActiveState=failed' in props
  deleted['units'].append(name)
 # Only the exact project-owned NAT chain and jumps are removed; no table flush.
 _,raw=command(['iptables','-w','5','-t','nat','-S'])
 rules=[shlex.split(line) for line in raw.decode().splitlines()]
 for rule in rules:
  if rule[:1]==['-A'] and any(rule[i:i+2] in [['-j','FINTECH_PROXY_ONLINE'],['-g','FINTECH_PROXY_ONLINE']] for i in range(len(rule)-1)):
   command(['iptables','-w','5','-t','nat','-D',*rule[1:]])
 if any(rule==['-N','FINTECH_PROXY_ONLINE'] for rule in rules):
  command(['iptables','-w','5','-t','nat','-F','FINTECH_PROXY_ONLINE'])
  command(['iptables','-w','5','-t','nat','-X','FINTECH_PROXY_ONLINE'])
 # Current IDs are reobserved, including short-lived fintech-qa containers.
 for c in containers():
  assert c['project'] in projects
  assert c['image'] in image_ids, 'UNREVIEWED_FINTECH_IMAGE'
  if c['running']:docker('stop','--time','60',c['id'])
  docker('rm',c['id']);deleted['containers'].append(c['id'])
 assert not containers(), 'NEW_CONTAINER_OR_OWNER_REMAINS'
 for v in PLAN['volumes']:
  assert v['name'].startswith('fintech-lab_') and v['driver']=='local'
  actual=json.loads(docker('volume','inspect',v['name'])[1])[0]
  assert actual['Labels']['com.docker.compose.project']=='fintech-lab'
  assert actual['Mountpoint']==v['mountpoint'] and os.path.realpath(actual['Mountpoint'])==actual['Mountpoint']
  s=os.lstat(actual['Mountpoint']);assert (s.st_dev,s.st_ino)==(v['root']['dev'],v['root']['ino'])
  assert not any(m.get('Name')==v['name'] for c in containers() for m in c['mounts'])
  docker('volume','rm',v['name']);deleted['volumes'].append(v['name'])
 # Remove tags without --force/automatic parent pruning; shared external refs refuse.
 pending=[]
 for image in PLAN['images']:
  assert not image['nonFintechReferences'] and not image['otherTags']
  current_tags=image_tags(image['id'])
  assert current_tags is not None and all(tag.startswith('fintech-lab:') for tag in current_tags), 'NEW_NON_FINTECH_IMAGE_TAG'
  for tag in image['fintechTags']:
   assert tag.startswith('fintech-lab:')
   tag_id=docker('image','inspect','--format','{{.Id}}',tag)[1].decode().strip()
   assert tag_id==image['id'], 'IMAGE_TAG_DRIFT'
   code,_=docker('image','rm','--no-prune',tag,allowed=(0,1))
   if code==0:deleted['tags'].append(tag)
  pending.append(image['id'])
 for _ in range(len(pending)+1):
  progress=False
  for image in pending[:]:
   tags=image_tags(image)
   if tags is None:pending.remove(image);deleted['images'].append(image);progress=True;continue
   assert all(tag.startswith('fintech-lab:') for tag in tags), 'NEW_NON_FINTECH_IMAGE_TAG'
   code,_=docker('image','rm','--no-prune',image,allowed=(0,1))
   if code==0:pending.remove(image);deleted['images'].append(image);progress=True
  if not pending or not progress:break
 assert not pending, 'REFERENCED_IMAGE_REMAINS'
 # Remove only named Fintech networks, after all project endpoints are absent.
 _,raw=docker('network','ls','--quiet')
 for network in raw.decode().splitlines():
  n=json.loads(docker('network','inspect',network)[1])[0]
  if (n.get('Labels') or {}).get('com.docker.compose.project') in projects or n['Name'].startswith('fintech-'):
   assert not n['Containers'] and not n.get('Ingress')
   docker('network','rm',network);deleted['networks'].append(n['Name'])
 # Each recursive target must be the exact reviewed canonical path and filesystem.
 mountpoints=[]
 for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():mountpoints.append(line.split()[4].replace('\\040',' '))
 for target,old in sorted(allowed_roots.items(),key=lambda item:(0 if item[0].startswith('/etc/nginx/sites-enabled/') else 1,item[0])):
  locked();assert target!='/' and not target.startswith(('/srv/sabalanerp','/root/sabalan-recovery-private','/var/lib/docker'))
  s=os.lstat(target);assert (s.st_dev,s.st_ino)==(old['dev'],old['ino']) and s.st_uid==old['uid']
  assert os.path.realpath(target)==old['realpath']
  assert not any(m==target or m.startswith(target+'/') for m in mountpoints)
  event('PATH_REMOVE_INTENT',path=target,inode=s.st_ino,device=s.st_dev)
  if stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode):
   assert os.path.realpath(target)==target and s.st_dev==device
   shutil.rmtree(target)
  else:os.unlink(target)
  assert not os.path.lexists(target);deleted['paths'].append(target);event('PATH_REMOVED',path=target)
 command(['systemctl','daemon-reload'])
 command(['nginx','-t'])
 if nginx_state=='active':command(['systemctl','reload','nginx'])
 os.sync()
 assert protected_snapshot()==before_protected, 'SABALAN_PROTECTION_CHANGED'
 assert not containers()
 _,raw=docker('image','ls','--all','--quiet','--no-trunc');after_ids=set(raw.decode().splitlines())
 assert remaining_before<=after_ids, 'NON_FINTECH_IMAGE_CHANGED'
 assert non_fintech_tags()==non_fintech_tags_before, 'NON_FINTECH_TAG_MAPPING_CHANGED'
 assert not image_ids&after_ids
 remaining_units=command(['systemctl','list-units','--state=active,activating','--plain','--no-legend','fintech*'])[1].decode().strip()
 assert not remaining_units
 for proc in pathlib.Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:assert os.readlink(proc/'exe') not in ['/usr/local/bin/fintech-xray','/usr/local/bin/fintech-xray (deleted)']
  except OSError:pass
 status='COMPLETE'
except BaseException as failure:
 error={'type':type(failure).__name__,'message':str(failure)[:400]}
finally:
 locked();after_space=os.statvfs(protected);after_free=after_space.f_bavail*after_space.f_frsize
 event('RETIREMENT_RESULT',status=status,error=error,afterAvailable=after_free,deleted=deleted)
 os.close(auditfd)
 print(json.dumps({'format':'sabalan-fintech-retirement-result/v1','status':status,'cleanupPerformed':bool(any(deleted.values())),'canonicalAuditAppend':False,'fullAccepted':False,'beforeAvailableBytes':before_free,'availableBytesAfter':after_free,'reclaimedBytesObserved':after_free-before_free,'deleted':deleted,'error':error,'auditFile':audit_file,'protectedSabalanDigestBefore':before_protected,'protectedSabalanDigestAfter':protected_snapshot(),'originalStorageLock':{'device':original.st_dev,'inode':original.st_ino,'exclusive':True},'events':events}))
