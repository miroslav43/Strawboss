# Instalare StrawBoss ca „Device Owner” (telefoane dedicate operatorilor)

Ghid pas-cu-pas pentru a transforma un telefon Android **nou** într-un dispozitiv
dedicat StrawBoss, unde aplicația:

- **își acordă singură toate permisiunile** (locație „Permite mereu”, notificări,
  cameră) — fără nicio atingere pe telefon;
- **nu poate fi oprită, ștearsă sau dezinstalată** de operator și repornește singură;
- la intrarea/ieșirea dintr-un **geofence** se **deschide singură peste orice altă
  aplicație și peste ecranul blocat**, aprinzând ecranul;
- lasă telefonul **utilizabil normal** pentru orice altceva (NU e mod kiosk).

> ⚠️ **Acest APK e DOAR pentru telefoane dedicate.** Nu îl instala pe telefoane
> personale: nu se mai pot dezinstala/opri ușor (doar prin „Eliberare” din aplicație
> sau reset din fabrică).

---

## Cuprins
1. [De ce e nevoie de „Device Owner”](#1-de-ce-device-owner)
2. [Cerințe](#2-cerinte)
3. [Pasul 0 — Construiește APK-ul](#3-pasul-0--construieste-apk-ul)
4. [Pasul 1 — Găzduiește APK-ul pe HTTPS](#4-pasul-1--gazduieste-apk-ul-pe-https)
5. [Pasul 2 — Generează codul QR](#5-pasul-2--genereaza-codul-qr)
6. [Pasul 3 — Înrolează fiecare telefon (QR)](#6-pasul-3--inroleaza-fiecare-telefon-qr)
7. [Alternativă: înrolare prin cablu (ADB)](#7-alternativa-inrolare-prin-cablu-adb)
8. [Verificare](#8-verificare)
9. [Depanare](#9-depanare)
10. [Dezafectare (scoaterea unui telefon din uz)](#10-dezafectare)
11. [De evitat](#11-de-evitat)

---

## 1. De ce „Device Owner”

Android **nu** permite unei aplicații obișnuite să-și acorde singură locația-fundal
(„Allow all the time”) pe Android 12+, și **nu** permite unei aplicații din fundal
să se deschidă singură peste alte aplicații. Singurul mod în care se obține tot ce
ai cerut este ca telefonul să fie **„Device Owner”** (dispozitiv complet gestionat),
cu StrawBoss ca propriul controller. Atunci:

- un **device owner** (spre deosebire de un profil de lucru) **poate** acorda
  silențios locația-fundal;
- un device owner e **scutit** de restricția care interzice pornirea din fundal a
  unei ferestre → aplicația poate sări în față peste orice;
- poate bloca oprirea/dezinstalarea aplicației.

„Device Owner” se poate seta **doar pe un telefon proaspăt** (resetat din fabrică,
fără niciun cont adăugat) — exact cazul telefoanelor tale noi.

---

## 2. Cerințe

- Telefon Android **nou sau resetat din fabrică**, **fără niciun cont Google adăugat**.
- Un calculator pentru a construi APK-ul și a genera QR-ul.
- Acces la serverul VM (nginx + Let’s Encrypt) pentru a găzdui APK-ul pe HTTPS.
- (Opțional, pentru metoda prin cablu) un cablu USB + `adb`.

---

## 3. Pasul 0 — Construiește APK-ul

Construiește APK-ul ca de obicei (EAS profilul `apk` sau gradle local). Plugin-ul
`withDeviceOwner` rulează automat la `expo prebuild` și injectează tot ce trebuie.

> ❗ **Nu merge în Expo Go** — e nevoie de un build nativ (dev-client sau release).

Exemple (rulate de tine, din `apps/mobile`):

```bash
# EAS (recomandat)
npm run build:android          # profilul "apk"

# sau local
npm run build:apk              # expo prebuild --clean + gradlew assembleRelease
```

> 🔒 `build:apk` produce un build **release** (`android:debuggable=false`,
> minificat cu R8), semnat tot cu `debug.keystore`-ul fixat (nu se schimbă —
> altfel se strică auto-update-ul OTA pe telefoanele deja înrolate). Un APK
> `debuggable` ar permite citirea bazei SQLite/PII prin `run-as`/adb pe orice
> telefon din flotă — de aceea flota **nu** mai folosește `assembleDebug`.

Rezultă un fișier, ex. `strawboss-deviceowner.apk`.

---

## 4. Pasul 1 — Găzduiește APK-ul pe HTTPS

Telefonul descarcă APK-ul în timpul înrolării, deci trebuie să fie accesibil pe
**HTTPS cu certificat valid** (Let’s Encrypt). HTTP simplu sau certificat
auto-semnat **sunt respinse** de Android.

Folosește convenția de găzduire de pe acest VM (skill-ul `host-site-on-this-vm`) ca
să publici fișierul la o adresă de tipul:

```
https://provision.strawboss.<domeniul-tau>/strawboss-deviceowner.apk
```

> 🔁 La fiecare reconstrucție a APK-ului, **re-urci fișierul ȘI regenerezi QR-ul**
> (checksum-ul e legat de conținutul exact al APK-ului).

---

## 5. Pasul 2 — Generează codul QR

Din `apps/mobile`:

```bash
node tools/provisioning/generate-qr.mjs \
  --apk /cale/catre/strawboss-deviceowner.apk \
  --url https://provision.strawboss.<domeniul-tau>/strawboss-deviceowner.apk \
  --ssid "WifiFerma" --pass "parola-wifi" --security WPA \
  --out strawboss-do-qr.png
```

- Calculează automat checksum-ul (SHA-256) din APK-ul local — mereu corect.
- Scrie imaginea `strawboss-do-qr.png` (printează-o sau afiseaz-o pe un alt ecran).
- Argumentele Wi-Fi sunt opționale (te poți conecta manual la Wi-Fi în timpul setării).
- Dacă pachetul `qrcode` nu e instalat, scriptul scrie JSON-ul într-un `.txt` pe
  care îl poți lipi în orice generator de QR online.

---

## 6. Pasul 3 — Înrolează fiecare telefon (QR)

Pentru fiecare telefon (cele ~30):

1. Pornește un telefon **proaspăt din fabrică** (sau fă reset din fabrică).
   **NU adăuga niciun cont Google** — înrolarea eșuează dacă există vreun cont.
2. Pe primul ecran **„Hi there / Bun venit”**, **atinge ecranul de 6 ori** în
   același loc. Se deschide cititorul de cod QR pentru înrolare.
3. Conectează-te la Wi-Fi dacă ți se cere (sau folosește datele Wi-Fi din QR).
4. **Scanează `strawboss-do-qr.png`.** Telefonul descarcă APK-ul de la adresa HTTPS,
   verifică checksum-ul, îl instalează și îl setează ca Device Owner.
5. Aplicația își aplică singură toate politicile + permisiunile. Operatorul doar
   se loghează — gata.

---

## 7. Alternativă: înrolare prin cablu (ADB)

Pentru primul telefon / banc de test, fără QR:

```bash
adb install -r /cale/catre/strawboss-deviceowner.apk
adb shell dpm set-device-owner com.strawboss.mobile/.StrawbossDeviceAdminReceiver
```

Condiții obligatorii (altfel comanda eșuează):
- APK-ul deja instalat;
- **niciun cont** pe telefon (șterge toate conturile sau reset din fabrică);
- un singur utilizator.

---

## 8. Verificare

```bash
# 1) Confirmă că suntem Device Owner
adb shell dpm list-owners
#   → trebuie să apară com.strawboss.mobile/.StrawbossDeviceAdminReceiver

# 2) Confirmă că permisiunile sunt acordate automat (inclusiv locația-fundal)
adb shell dumpsys package com.strawboss.mobile | grep -A40 "runtime permissions"
#   → ACCESS_BACKGROUND_LOCATION: granted=true, plus fine/coarse/CAMERA/POST_NOTIFICATIONS

# 3) Confirmă că NU se poate dezinstala
adb shell pm uninstall com.strawboss.mobile
#   → Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]
```

În telefon: Setări → Aplicații → StrawBoss — butoanele **„Force stop”** și
**„Dezinstalează”** sunt gri/indisponibile.

**Test „deschidere peste alte aplicații”:** deschide altă aplicație (ex. Chrome),
intră fizic (sau cu o locație simulată) într-un câmp/depozit — StrawBoss trebuie să
apară peste Chrome și să aprindă ecranul dacă era stins.

---

## 9. Depanare

| Simptom | Cauză / Soluție |
|---|---|
| `Not allowed to set the device owner because there are already some accounts` | Telefonul are un cont. Șterge toate conturile sau fă reset din fabrică. |
| Înrolarea QR eșuează la descărcare | URL-ul nu e HTTPS, certificat invalid, sau **checksum vechi** (ai reconstruit APK-ul fără să regenerezi QR-ul). Regenerează QR-ul. |
| Locația-fundal NU e acordată | Cineva a adăugat `PROVISIONING_SENSORS_PERMISSION_GRANT_OPT_OUT` în QR. **Scoate-l** și regenerează. |
| Nu apare peste alte aplicații | Verifică `dpm list-owners` (trebuie să fim owner). Pe non-device-owner se folosește notificarea full-screen, care necesită permisiunea „Alerte ecran complet”. |
| Aplicația nu repornește după restart | Verifică „Autostart / Pornire automată” pe ROM-urile agresive (Xiaomi/Huawei). Pe device owner de obicei nu e necesar. |

---

## 10. Dezafectare

Când scoți un telefon din uz (Device Owner-ul e „lipicios”):

- **Din aplicație:** Profil → atinge insigna de rol **de 5 ori** (apar uneltele
  ascunse) → **„Eliberează dispozitivul”**. Renunță la statutul de Device Owner;
  după aceea aplicația poate fi dezinstalată.
- **Sau** reset din fabrică (am lăsat resetul permis intenționat, ca plasă de
  siguranță).

---

## 11. De evitat

- ❌ **Nu** adăuga `PROVISIONING_SENSORS_PERMISSION_GRANT_OPT_OUT` în QR — anulează
  acordarea automată a locației-fundal.
- ❌ **Nu** instala acest APK pe telefoane personale/BYOD.
- ❌ **Nu** publica acest APK pe Google Play public (politica Google pentru
  locație-fundal + device-admin).
- ✅ Preferă telefoane Pixel / Samsung / Motorola — au înrolarea cea mai predictibilă.

---

### Referințe tehnice
- Detalii dezvoltator + scriptul QR: `apps/mobile/tools/provisioning/README.md`
- Plugin nativ: `apps/mobile/plugins/withDeviceOwner.js`
- Detecție geofence + trezire ecran: `apps/mobile/src/lib/geofence-wake.ts`,
  `apps/mobile/src/lib/wake-alert.ts`
