# StrawBoss — Lista de funcționalități

**StrawBoss** este o platformă de logistică agricolă pentru recoltarea și transportul baloților de paie. Acoperă tot lanțul: planificarea zilei, presarea pe câmp, încărcarea camioanelor, transportul până la depozit și confirmarea livrării — plus documentele și rapoartele care rezultă.

Platforma are două aplicații:

- **Aplicația mobilă** (Android) — pentru oamenii din teren. Funcționează **complet offline**; datele se sincronizează singure când revine semnalul.
- **Aplicația web** (dashboard) — pentru birou: planificare, monitorizare în timp real, rapoarte, documente.

Ambele aplicații sunt disponibile în **română** și **engleză**.

## Cine ce folosește

| Rol | Unde lucrează | Ce face |
|---|---|---|
| **Șofer** | Mobil | Transportă baloții de la câmp la depozit |
| **Operator încărcare** | Mobil | Încarcă camioanele pe câmp și numără baloții |
| **Operator presă** | Mobil | Presează baloții și înregistrează producția |
| **Operator depozit** | Mobil | Confirmă livrările la depozit și cântărește |
| **Planificator câmp** | Mobil | Desenează parcelele și depozitele pe hartă |
| **Dispecer** | Web | Planifică ziua, urmărește cursele, gestionează transportatorii externi |
| **Administrator** | Web | Tot ce face dispecerul, plus conturi, mașini, setări, rapoarte |
| **Super administrator** | Web | Gestionează organizațiile și flota de telefoane |

---

---

# PARTEA 1 — APLICAȚIA MOBILĂ

Aplicație Android, gândită pentru oameni care lucrează pe câmp: butoane mari, funcționează fără semnal, ecranul rămâne aprins cât timp lucrezi.

## Funcționalități comune tuturor rolurilor

### Autentificare și pornire

- Se conectează cu **utilizator + PIN de 4 cifre** — nu trebuie să țină minte parolă sau email.
- Alternativ se poate conecta cu email + parolă.
- **Rămâne conectat între reporniri** — operatorul nu se re-loghează la fiecare tură, nici după ce telefonul e restartat.
- Dacă rețeaua e proastă la începutul turei, aplicația **nu îl deloghează** — afișează un buton de reîncercare și păstrează sesiunea.
- Pornește direct pe ecranul rolului său, **chiar și fără semnal**.
- Dacă pe același telefon se conectează alt utilizator, datele locale ale celui vechi sunt șterse automat.
- **Ghid de introducere** (3-4 ecrane) la prima folosire, diferit pentru fiecare rol. Poate fi sărit oricând.

### Lucrul offline

- **Tot ce înregistrează operatorul se salvează pe telefon**, chiar fără semnal: producție, încărcări, alimentări, consumabile, livrări.
- Datele se trimit automat la server când revine semnalul — operatorul nu trebuie să facă nimic.
- **Bara de sincronizare** e mereu vizibilă în partea de jos: „Tot sincronizat" / câte înregistrări așteaptă / dacă ceva a eșuat.
- **Ecran de detalii sincronizare** — lista fiecărei înregistrări în așteptare sau eșuate, cu ce e (Curse, Încărcări, Producție, Combustibil, Consumabile), când a fost făcută, ce eroare a apărut, și buton de reîncercare individual.
- **Anulare (5 secunde)** — după fiecare salvare apare un buton „Anulează"; dacă operatorul a greșit, șterge înregistrarea înainte să plece la server.
- O înregistrare trimisă de două ori **nu se dublează** niciodată pe server.
- Dacă o valoare a fost modificată între timp de pe web, operatorul e notificat că i s-a suprascris.

### Hartă

- **Hartă satelit** cu parcelele, depozitele și celelalte utilaje ale echipei.
- **Punctul albastru** arată poziția proprie, actualizat la 15 secunde.
- Parcelele și depozitele sunt **salvate pe telefon**, deci se văd și fără semnal. (Imaginea satelit de fundal are nevoie de internet, dar formele terenurilor apar oricum.)
- Apasă pe o parcelă sau un depozit → fișă cu detalii.
- **Calculează ruta** până la o destinație (distanță în km + durată estimată).
- **Deschide în Google Maps** pentru navigație propriu-zisă — spre depozit sau spre încărcător.

### Notificări

- **Centru de notificări** cu tot istoricul, grupat pe zile (Azi / Ieri / dată), cu culori pe severitate. Se păstrează 7 zile.
- Clopoțel cu numărul de notificări necitite.
- Apasă pe o notificare → sare direct la ecranul relevant.
- **Alertă sonoră puternică** la ieșirea de pe câmp (sunet propriu, trece peste modul silențios) — ca operatorul să nu rateze momentul înregistrării producției.
- **Trezirea ecranului**: pe telefoanele companiei, alerta importantă aprinde ecranul peste orice altă aplicație și peste ecranul de blocare.

### Profil și instrumente

- Poză de profil, nume, rol, mașina asignată.
- **Semnătură-specimen** — operatorul își desenează semnătura o singură dată; de atunci e folosită automat la fiecare document. Șoferii și operatorii de încărcare sunt obligați s-o creeze la prima folosire.
- **Raport zilnic** — generează un PDF cu activitatea de azi (baloți presați, litri alimentați, consumabile, încărcări) și îl trimite **pe WhatsApp sau email** cu un buton.
- **Mod contrast ridicat** — paletă pentru soare puternic, ca ecranul să fie citibil pe câmp.
- **Configurare urmărire** — ghid pas cu pas pentru permisiunile pe care Android nu le poate acorda singur (locație „Tot timpul", excludere din economisirea bateriei, pornire automată).
- **Raportează o problemă** — trimite o sesizare de mentenanță către birou.
- **Statistici personale** — cât a produs operatorul.
- Deconectare, cu avertisment dacă mai are înregistrări nesincronizate.

---

## Rol: Șofer

Tab-uri: **Cursele Mele · Livrare · Hartă · Combustibil · Profil**

### Cursele Mele
- Vede lista curselor sale active, cu status, număr de baloți și oră de plecare.
- **Badge NOU** pe cursele proaspăt încărcate pe care nu le-a văzut încă.
- **„Loadere din apropiere"** — ce încărcătoare sunt prin zonă și la câți metri, actualizat live.
- **„Sarcina de azi"** — ce i s-a planificat pentru ziua curentă.
- **„Deschide în Maps → loader"** — navigație directă către încărcător.
- Trage în jos pentru sincronizare.

### Livrare
- Vede cursa activă cea mai relevantă, cu **distanța până la depozit în timp real**.
- **Fluxul de livrare în 3 pași**: greutate → poză bon de cântar → semnătură și confirmare.
- Fluxul e **reluabil** — dacă telefonul moare la jumătate, revine exact de unde a rămas, fără să reintroducă nimic.
- Dacă depozitul are operator propriu, șoferul **așteaptă confirmarea acestuia** (nu confirmă el singur).

### Plecarea în cursă
- **Semnează cu specimenul salvat** — nu redesenează semnătura de fiecare dată.
- **Numărătoare inversă de 3 secunde** înainte de plecare, cu opțiune de anulare.

### Pe traseu
- **Confirmare automată la sosirea în depozit** — telefonul detectează singur intrarea în perimetru și îi propune confirmarea.
- Fișă completă de cursă, cu pașii parcurși și ce urmează.
- Poate alege destinația (depozitul) dacă nu i-a fost setată.

### Combustibil
- Înregistrează alimentarea în 3 pași: **litri** (tastatură numerică mare) → **poză la stație** → confirmare.
- Funcționează offline.

---

## Rol: Operator încărcare

Tab-uri: **Camioane · Încărcări · Hartă · Motorină · Profil**

### Camioane (ecranul principal)
- **Câmpul activ se detectează automat prin GPS** — operatorul nu alege niciodată manual parcela pe care se află.
- **„Camioane la loader"** — ce camioane sunt lângă el, la câți metri, și dacă sunt încărcate sau gata de încărcat. Se actualizează la 10-15 secunde.
- **„Camioane auxiliare"** — camioanele transportatorilor externi, cu număr de înmatriculare, numele și telefonul șoferului extern, cultura și calitatea baloților.
- **Rechemare camion** — întrebare Da/Nu: „mai vine un camion pentru încă o tură?". Da → sistemul cheamă automat șoferul.
- **Alertă „camion se apropie"** — e anunțat înainte să ajungă camionul.

### Încărcarea propriu-zisă („Camion plin")
- **Zero selecție de parcelă** — câmpul vine din GPS.
- **Verificare GPS strictă** — trebuie să fie efectiv pe câmp ca să poată înregistra.
- **Limită de baloți pe camion** (implicit 33, configurabilă per mașină) — nu poate depăși.
- Funcționează offline: se salvează local și pleacă la server când revine semnalul.
- Pentru camioanele externe: **scanează CMR-ul pe hârtie** cu camera (detectare automată a marginilor, decupare, până la 10 pagini), se transformă în PDF și se trimite. Merge și offline.

### Încărcări
- Sarcinile planificate de birou.
- Camioanele de încărcat.
- **„Încărcări azi"** — tot ce a încărcat în ziua curentă, inclusiv cele nesincronizate încă.

### Motorină
- Înregistrează alimentarea utilajului său.

---

## Rol: Operator presă

Tab-uri: **Acasă · Producție · Hartă · Consumabile · Profil**

### Acasă
- Câmpul activ (detectat prin GPS) și distanța până la el.
- Sarcinile de azi. Apasă pe o sarcină → fișa parcelei.

### Producție
- **Tastatură numerică mare** pentru numărul de baloți.
- **Mod „Câmp activ"** — ecran minimal (doar tastatura, salvare și contor), ecranul rămâne aprins permanent, pentru lucrul continuu pe câmp.
- Funcționează offline, cu anulare de 5 secunde.

### Intrare / ieșire de pe câmp (automat)
- **La intrarea pe câmp**: confirmare automată după 10 secunde — nu trebuie să apese nimic dacă totul e în regulă.
- **La ieșirea de pe câmp**: alertă sonoră puternică + ecran de introducere a producției.
- **Parțial sau Total** — la final alege explicit dacă parcela e terminată sau nu. Nu există valoare implicită ascunsă — sistemul nu presupune niciodată că un câmp e gata.

### Consumabile
- Înregistrează **motorină** sau **sfoară**.

---

## Rol: Operator depozit

Tab-uri: **Inventar · Curse · Profil**

Ecran deliberat simplu: fără GPS, fără scanare.

### Inventar
- **Total baloți și tone nete** din depozit.
- Comută între mai multe depozite dacă gestionează mai multe.
- Ultima livrare primită.
- Primele camioane care vin spre el.
- **Funcționează complet offline.**

### Curse
- Lista camioanelor care vin, cu status (în drum / a ajuns / se descarcă), număr, șofer, baloți.
- **Badge „în perimetru"** când camionul a ajuns efectiv la depozit.

### Confirmarea livrării
- **Se poate confirma doar când camionul e efectiv la depozit** — dacă e în afara perimetrului, ecranul e blocat și îi arată la ce distanță e.
- Numără baloții (valoarea vine precompletată).
- La depozitele principale: **greutate brută + tară**, cu net calculat automat.
- **Comutator „cântar stricat"** — dacă cântarul nu merge, poate confirma fără greutate în loc să blocheze camionul.
- **Semnătura operatorului de depozit.**
- Dacă apasă de două ori din greșeală, **nu se dublează** livrarea.

---

## Rol: Planificator câmp

Tab-uri: **Hartă · Ferme · Profil**

### Hartă — desenarea terenurilor
- **Desenează parcele direct pe hartă satelit**, în stil Google Earth: mută harta, apasă „Adaugă punct" pentru fiecare colț, „Finalizează" de la 3 puncte în sus.
- **Suprafața în hectare se calculează automat** în timp ce desenează.
- Desenează și **perimetre de depozit**.
- Punct albastru cu poziția proprie, centrare automată la prima localizare.
- **Terenul desenat apare pe hartă imediat, chiar și fără semnal** — se sincronizează după.

### Ferme
- **Creează ferme**: nume, telefon, tip (persoană juridică / fizică), CUI, cod APIA, adresă.
- Vede parcelele fiecărei ferme, cu status de recoltare pe culori.
- Secțiune separată cu **parcelele neatribuite**.
- **Atribuie o parcelă unei ferme.**
- Apasă pe o parcelă → harta sare pe ea.

---

---

# PARTEA 2 — APLICAȚIA WEB (DASHBOARD)

Dashboard pentru birou. Se actualizează **în timp real** — când ceva se schimbă în teren, ecranul se actualizează singur, fără refresh.

## Comun

- **Autentificare** cu email + parolă (birou) sau utilizator + PIN (operatori).
- **Comutator română / engleză**, salvat pe profil.
- **Meniu lateral pliabil**, se transformă în sertar pe telefon/tabletă.
- **Clopoțel cu alertele neconfirmate**, numărate live.
- **Bandă de avertizare** dacă se pierde conexiunea în timp real, cu buton de reconectare.
- Pagina de start: **4 indicatori** (baloți azi, curse active, utilaje active, alerte noi), fiecare cu **tendință față de ieri**, grafic pe 7 zile, top operatori și ultimele curse.

---

## Administrator + Dispecer

Cele două roluri lucrează practic pe același ecran. Cele 18 secțiuni de meniu:

### Centru de comandă
- **Ecran împărțit**: hartă live în stânga (parcele, utilaje, depozite), flux de curse active în dreapta.
- Fiecare cursă din flux: număr, status colorat, parcela sursă, destinație, baloți. Click → fișa cursei.
- Contor live de curse active.

### Sarcini (planificarea zilei)
- **Selector de zi** — azi, mâine, sau orice dată — comun celor 4 tab-uri.
- **Vedere de ansamblu**: câte prese, încărcătoare și camioane sunt în lucru, plus tablou Planificat / În lucru / Terminat.
- **Tablou prese** și **tablou încărcătoare**: atribuie utilaje la parcele, **reordonează prin drag & drop** coada de parcele, alege parcela prin **cascadă Fermă → Parcelă** sau **direct de pe hartă**, cu **bulină de prezență** live a operatorului.
- **Tablou camioane**: atribuie camionul la un **depozit** și la un **încărcător** (ales prin click pe harta cu încărcătoare).
- **Tablou kanban** Disponibil → În lucru → Terminat, cu drag & drop între coloane.

### Curse
Pagina are **două registre separate**, pentru că sunt două lucruri diferite:

**Cursele flotei proprii** (toată lumea)
- Căutare, filtre pe interval de date și pe status.
- Coloane: număr, status, camion, șofer, sursă, destinație, baloți, greutate netă, dată.
- **Evidențiere când lipsesc baloți** față de cât s-a încărcat.
- Ștergere cursă *(doar dispecer/admin)*.

**Curse auxiliare — transportatori externi** *(doar dispecer/admin)*
- **Card de intrare** pentru fiecare solicitare nouă venită prin portal — Confirmă / Anulează / Vezi.
- **Confirmă o solicitare** → alege depozitul → se creează cursa automat.
- **Anulează** cu motiv.
- Filtru pe etapă; coloane cu solicitant, camion, șofer, cultura, ridicare, destinație, dată necesară, cursa legată.
- **Încarcă avizul (PDF)** — cu verificare de tip și mărime, confirmare înainte de înlocuire, previzualizare.
- **Încarcă CMR-ul scanat (PDF)** — CMR-ul pe hârtie al șoferului.
- **Etape colorate**, inclusiv „așteaptă semnătura șoferului extern".

**Fișa cursei**
- Cronologie a stărilor, secțiuni pentru transport, traseu, încărcare, greutate, momente, livrare și **confirmarea depozitului**.
- **Cele trei semnături**: operator încărcare, șofer, depozit.
- **Descarcă CMR-ul** generat.
- **Forțare status** — instrument de recuperare pentru situații excepționale, cu avertisment și confirmare.

### Hartă
- **Desenează parcele și perimetre de depozit** direct pe hartă satelit, cu **suprafața în hectare calculată live** înainte de salvare.
- Modifică conturul sau datele (nume, comună, suprafață, observații); șterge cu confirmare.
- **Panou lateral** cu liste filtrabile de Utilaje / Ferme+Parcele / Depozite; bifă de afișare per element; ascunderea unei ferme ascunde toate parcelele ei; click → harta sare pe element. **Starea panoului se ține minte între vizite.**
- **Pastilă de status live** — câte utilaje sunt online.
- **Iconiță de hartă personalizabilă pentru fiecare utilaj.**

### Trasee (istoric GPS)
- Alege tipul de utilaj și utilajul, apoi **culoarea** și **grosimea liniei**.
- Interval: ultima oră / zi / săptămână / lună, sau interval personalizat.
- **Suprapune mai multe trasee simultan**, cu legendă: afișează/ascunde fiecare traseu, număr de puncte, ștergere.

### Rapoarte
Filtru global pe interval + **5 indicatori** (produs, încărcat, livrat, stoc depozit, **procent pierdere**). **10 tab-uri**, fiecare cu **export CSV** (se deschide curat în Excel, cu diacritice):

| Tab | Ce arată |
|---|---|
| Ferme | Producție per fermă, grafic + cronologie, procent pierdere |
| Câmpuri | Produs / încărcat / **rămas** / livrat, per câmp |
| Depozite | Stoc, primit în perioadă, în sosire, livrări |
| Clasamente | Topuri pe ferme și depozite |
| Costuri | Motorină vs. consumabile vs. total |
| Operatori | Baloți per operator, sesiuni, medie pe sesiune |
| Producție utilaje | Per utilaj și operator |
| Km per camion | Grafic + tabel + acces la traseul din ziua respectivă |
| Km per operator | Distanță per operator |
| Ore conectate | Timp lucrat per utilizator, grupat pe zi / săptămână / lună |

- **Printare** — layout dedicat de tipărire, cu indicatori, tabele și dată.

### Alerte
- Filtre pe categorie, severitate și confirmat/neconfirmat.
- **Confirmă o alertă** direct din listă.

### Mesaje
- Monitor pentru **email și SMS** trimise.
- Filtre pe canal și status (în așteptare / trimis / livrat / eșuat).
- Coloane: când, canal, destinatar, status, previzualizare sau textul erorii.
- **Buton de reîncercare** pentru mesajele eșuate.

### Documente
- Lista documentelor generate, filtru pe tip, status colorat.
- **Vizualizare** PDF/imagine direct în pagină.

### Beneficiari
- Creează/modifică/șterge beneficiari: nume, **slug de portal**, firmă, email, adresă, CUI.
- **Copiază linkul de portal** în clipboard.
- **Regenerează PIN-ul** de portal.
- Activează/dezactivează.

### Ferme
- Creează/modifică/șterge: nume, telefon, tip entitate, CUI, **cod APIA**, adresă.
- Rânduri expandabile cu parcelele fiecărei ferme.
- **Atribuire în masă** a parcelelor neatribuite, cu căutare și filtru pe comună.
- **Import KML** — încarcă fișierul, previzualizează parcelele, alege ferma destinație.

### Câmpuri (parcele)
- Filtre: căutare, status recoltare, comună, fermă (inclusiv „neatribuite"). Coloane sortabile.
- Creează/modifică: nume, suprafață, fermă, comună, adresă, observații, status recoltare, **tip cultură** (grâu, orz, rapiță, plante nutreț, altele).
- **Corecție manuală a numărului de baloți**, cu transfer către un depozit.
- **Statusul de recoltare merge doar înainte** — sistemul nu permite retrogradarea unui câmp deja recoltat.

### Depozite
- Căutare, filtru activ/inactiv, tabel sortabil, ultima activitate.
- Creează/modifică/șterge.

### Mașini
- Filtre pe status și tip de combustibil; badge-uri de tip; **buline de prezență**.
- Creează/modifică/șterge: cod, marcă, model, tip, număr, combustibil, capacități.
- **Rezumat km per camion.**
- **Fișa utilajului**: hartă cu ultima poziție, grafic de activitate, curse recente, ultimele alerte, plus trei carduri de gestiune:
  - **Motorină** — grafic pe litri, adaugă/modifică/șterge alimentări, poze la bonuri.
  - **Producție baloți** — înregistrări per parcelă.
  - **Consumabile** — grafic pe cantitate, cu poze la bonuri.

### Motorină și Consumabile (global)
- Grupate și expandabile pe utilaj, cu operator, dată și **miniaturi ale bonurilor**.

### Conturi
- Utilizatori grupați pe rol, cu **bulină de prezență**.
- **Creare cont**: nume, rol, telefon — **utilizatorul și PIN-ul se generează automat**, cu posibilitatea de a schimba utilizatorul.
- **Modificare**: poză, nume, rol, telefon, limbă, activ/inactiv, utilizator, PIN.
- **Arată / copiază PIN-ul** cu un click.
- Dezactivare cont.

### Setări
- **Profil**: nume, telefon, **limba interfeței**.
- **Schimbare parolă.**
- **Semnătură-specimen** — desenează, previzualizează, salvează.
- **Setările portalului**: **codul de acces public** și **ce culturi acceptă** portalul.

---

## Super Administrator

Consolă separată, **singura zonă cu acces cu adevărat restricționat**.

### Organizații
- Lista tuturor organizațiilor, cu acces direct în dashboard-ul fiecăreia.
- **Creează organizație** — nume + slug, cu previzualizarea URL-ului.
- **Gestionează utilizatorii oricărei organizații** — creare în oricare din cele 8 roluri, cu utilizator și PIN generate automat; modificare; dezactivare; **dezvăluie și copiază credențialele** (utilizator / email / PIN / parolă) cu avertisment de unică afișare.

### Flotă de telefoane
- Lista dispozitivelor: **bulină de prezență în 3 stări** (online / în repaus / offline), poreclă editabilă, model, versiune de aplicație, stare actualizare, ultima activitate.
- **Trimite o actualizare** — alege versiunea și ținta: toate telefoanele / o organizație / o listă aleasă manual.
- **Versiuni de aplicație** — încarcă un APK cu versiune, jurnal de modificări și marcaj „obligatoriu"; publică sau arhivează.
- **Fișa dispozitivului**:
  - **Cronologia actualizării** — notificat / descărcat / instalat, cu momente exacte.
  - **Jurnalele telefonului**, citite de la distanță.
  - **Diagnostic de sănătate** — sesiune, prezență, sincronizare, locație, baterie, procese oprite recent.
  - **Comenzi la distanță**, cu istoric și status.
  - **Grafic de disponibilitate.**
  - **Acces la distanță** pentru depanare.
- **Gateway SMS** — marchează un telefon cu SIM ca expeditor de SMS-uri, trimite SMS de test.

### Mesaje (toate organizațiile)
- Jurnal de email/SMS cross-organizație, cu coloană de dispozitiv și reîncercare.

---

## Pagini publice (fără cont)

- **Portal de solicitare transport** — oricine are **codul de acces** al organizației completează o cerere: cultura, cantitate, loc de ridicare, destinație, data necesară, contact. Comutator română/engleză.
- **Portal beneficiar (cu PIN)** — beneficiarul intră cu un **PIN de 4 cifre** și primește un formular cu **datele salvate**: contacte, camioane și șoferi de dinainte, pe care le poate alege dintr-o listă în loc să le retasteze. Le poate adăuga, modifica sau șterge singur.
- **Semnare CMR prin link** — șoferul extern (fără cont, fără aplicație) deschide linkul primit, vede rezumatul încărcăturii (baloți, cultura, parcela, comuna) și **semnează cu degetul pe ecran**. Linkul e de unică folosință.

---

---

# PARTEA 3 — FUNCȚIONALITĂȚI DE PLATFORMĂ

## Ciclul de viață al cursei

Cursa nu poate sări peste etape — sistemul refuză orice pas care nu are sens. Există **două fluxuri diferite**:

**Flota proprie** (8 etape)
```
planificată → se încarcă → încărcată → în drum → a ajuns
   → se descarcă → livrată → finalizată
```
Plus **anulată** și **în dispută** (cu rezolvare).

Fiecare pas are condițiile lui: nu se poate încheia încărcarea fără cel puțin un balot înregistrat; nu se poate confirma livrarea fără greutate (exceptând depozitele temporare sau cazul „cântar stricat"); nu se poate finaliza fără numele și semnătura celui care primește.

**Transportatori externi** (3 etape)
```
planificată → încărcată → finalizată
```
Nu există plecare/sosire/descărcare — camionul extern nu are aplicație. Operatorul de încărcare termină încărcarea, iar cursa se finalizează automat câteva minute mai târziu. Semnătura șoferului extern (prin link public) finalizează CMR-ul.

În plus, o solicitare de transport are propria scară de etape vizibilă în registrul auxiliar: în așteptare → **neplanificată** → planificată → se încarcă → așteaptă semnătura → semnată → finalizată. Etapa „neplanificată" (confirmată, dar nimeni nu a programat-o încă) e afișată explicit tocmai pentru că altfel ar fi invizibilă.

**Curse multiple (mai multe ture)** — după o cursă finalizată, sistemul poate genera automat următoarea tură pe același câmp, cu același camion și șofer. Operatorul de încărcare răspunde Da/Nu la întrebarea „mai vine un camion?".

## Geofence — detecție automată de intrare/ieșire

- Detectează automat când un utilaj **intră** sau **iese** de pe o parcelă sau dintr-un depozit.
- **Toleranță la eroarea GPS**: utilajul e considerat înăuntru în raza de 30 m de limită și iese abia după 60 m — diferența împiedică un utilaj parcat pe margine să genereze alerte în buclă.
- **Alertă „camion se apropie"** — încărcătorul e anunțat când un camion vine spre el (rază de 5 km).
- Detecția funcționează și **direct pe telefon, fără semnal**, folosind geometria salvată local.
- Toate intrările și ieșirile sunt înregistrate.

## Alerte automate

Sistemul verifică singur și ridică alerte:

- **Nepotrivire de baloți** la finalizarea cursei — alertă de fraudă, severitate mare sau critică.
- **Anomalii de viteză** — curse anormal de rapide sau de lente (verificare la 15 minute).
- **Reconciliere baloți** — verificare orară: câți s-au produs, câți s-au încărcat, câți au ajuns; alertează la nepotriviri imposibile (mai mult încărcat decât produs).
- **Camion inactiv** — alertă către birou când un camion stă degeaba deși mai sunt baloți pe câmp (verificare la 5 minute).
- **Sesizări de mentenanță** trimise de operatori din teren.
- Alertele **nu se dublează** — o alertă neconfirmată pentru aceeași cursă nu se repetă la fiecare verificare.

Categorii: fraudă, anomalie, mentenanță, siguranță, sistem. Severități: mică, medie, mare, critică.

## GPS și trasee

- Poziția utilajelor se trimite automat, cu **cadență adaptivă** — mai deasă pe drum, mai rară pe câmp.
- **Funcționează offline**: până la 400 de poziții se rețin pe telefon și pleacă în bloc când revine semnalul.
- Istoric de trasee, cu km per camion și per operator.
- **Retenție automată**: rezoluție completă 14 zile, apoi comprimare la 1 punct/minut până la 90 de zile, apoi ștergere.
- Distanțele sunt calculate **din traseul GPS** — nu depind de ce declară cineva.

## Documente și CMR

- **CMR generat automat**, în două etape: parțial la plecare (semnături încărcător + șofer), final la destinație (cu greutate și semnătura celui care primește).
- **CMR scanat** — CMR-ul pe hârtie al transportatorilor externi, fotografiat cu telefonul, transformat în PDF.
- **Aviz** — încărcat din birou, cu trimitere automată pe email și SMS.
- Toate documentele sunt disponibile pentru descărcare din fișa cursei.

## Mesagerie

- **Email** către solicitanți, administratori și șoferi, la confirmarea transportului și la încărcarea avizului. *(Necesită configurarea serviciului de email.)*
- **SMS** trimise printr-un telefon cu SIM din flotă, folosit ca gateway.
- **Monitor centralizat** cu status pentru fiecare mesaj și buton de reîncercare — nimic nu se pierde tăcut.

## Management flotă telefoane

Pentru parcurile de telefoane dedicate (~30 dispozitive):

- **Se actualizează singure** — aplicația se instalează automat pe toate telefoanele, fără intervenția operatorului și fără magazin de aplicații.
- **Nu pot fi oprite din greșeală** — aplicația nu poate fi închisă forțat, dezinstalată sau dezactivată de utilizator.
- **Permisiuni acordate automat** la instalare, inclusiv locația în fundal.
- **Rămân online** — se recuperează singure după repornire sau actualizare.
- **Diagnostic la distanță** — starea fiecărui telefon e vizibilă din birou.
- **Comenzi la distanță** — repornire, colectare jurnale, reinstalare.

## Multi-organizație și securitate

- O instalare poate deservi **mai multe organizații**, complet separate una de alta.
- Fiecare organizație are propriul URL, propriile conturi și propriile date.
- **Nimic nu se șterge definitiv** — totul e marcat ca șters și rămâne recuperabil.
- **Jurnal de audit** — modificările importante se înregistrează cu cine, ce și când. Jurnalul nu poate fi modificat sau șters.
- **Protecție împotriva ghicirii PIN-urilor** pe portalurile publice.
- Conturile dezactivate pierd accesul în cel mult un minut.

---

*Document generat din codul sursă. Reflectă funcționalitatea existentă la data de 16 iulie 2026.*
