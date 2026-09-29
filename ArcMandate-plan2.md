# ArcMandate — Sınırlı agent harcaması, hybrid yönetim onayı

**Geliştirmeye geçiş:** Kesin fonksiyon arayüzleri, imza şeması ve kabul testleri için [Implementation Plan](ArcMandate-implementation-plan.md); görev sırası için [Roadmap](ArcMandate-roadmap.md) kullanılmalı. Bu dosya ürün kararlarının arka planıdır; teknik ayrıntıda yeni implementation plan önceliklidir.

**Sürüm:** 1.1 — 29 Eylül 2026 — daraltılmış yarışma MVP'si  
**Durum:** Uygulanacak ürün ve teknik kapsam planı; henüz geliştirilmiş ürün değildir.  
**Hedef:** Arc Microgrants için küçük, anlaşılır, mainnet üzerinde kanıtlanabilir bir MVP.  
**Hedef gönderim:** Kabul şartları geçerse 8 Ekim; gecikmede iç hedef 11 Ekim. Resmî son tarih: 14 Ekim 2026, 23:59 ET.  
**Karar:** Tek vault, tek agent oturumu, tek token, tek yönetim ekranı. Ayrı offline signer sonraki sürüme taşındı; şifreli anahtar yedeği ve geri yükleme testi MVP'de kaldı.

### İlk teslimde neyi kanıtlıyoruz?

1. Agent'ın toplam harcama yetkisi kontratta sınırlı; para yatırmak veya gün değişmesi bu yetkiyi büyütmüyor.
2. Yeni yetki ve para çekmek için insanın wallet onayı ile Arc'ın doğruladığı PQ imzası birlikte gerekiyor.
3. Acil durdurma eski oturumu ve eski işlemleri iptal ediyor; yeniden başlamak yeni hybrid onay gerektiriyor.

Bu üç davranış mainnet işlem kanıtlarıyla gösterilecek. Ürünün farklılaşmasını bu birleşim taşıyor. Başvurunun gücünü artırmak için öncelik sırası: doğru kontrat davranışı, anlaşılır demo, kolay tekrar üretim, sade ve tamamlanmış arayüz.

## 1. Ürün fikri

> ArcMandate, bir yazılım agent'ına belirli alıcılara, belirli süre boyunca, toplam belirli USDC harcama yetkisi verir. Agent bu yetkiyi büyütemez. Yeni yetki ve kasadan para çıkarma işlemleri, insanın normal wallet onayı ile Arc'ın native SLH-DSA doğrulamasını birlikte gerektirir.

İlk kullanıcı: API, veri veya araç satın alan bir agent çalıştıran birey ya da küçük ekip. Kullanıcının varlıklı olması gerekmez.

Kullanıcının ihtiyacı: Her küçük ödemeyi elle onaylamadan agent'a ödeme yaptırmak; agent yanlış karar verdiğinde veya anahtarı ele geçirildiğinde tüm kasayı riske atmamak.

Örnek: Kasada 20 USDC var. Kullanıcı agent'a iki belirli hizmet sağlayıcı için bir saat geçerli, toplam 1 USDC ve işlem başına 0,10 USDC yetki verir. Agent, kasadaki kalan 19 USDC için harcama yetkisi elde etmez. Kasaya yeni para yatırılması mevcut yetkiyi büyütmez.

### Ürünün üç temel sözü

1. Harcama kuralları agent'ın prompt'unda veya backend'de değil, parayı tutan kontratta uygulanır.
2. Oturumun toplam bütçesi otomatik sıfırlanmaz veya yenilenmez.
3. Agent anahtarı; bütçe artırma, süre uzatma, alıcı değiştirme, yeniden etkinleştirme veya serbest para çekme yetkisi taşımaz.

## 2. Rakiplerden farkı ve dürüst konumlandırma

| Proje | Mevcut yaklaşım | ArcMandate'in hedef farkı |
|---|---|---|
| Arc Guard | Wallet + SLH-DSA ile USDC kasası; gecikmeli klasik anahtarlı çıkış | Sınırlı agent yetkileri ve oturum iptali; otomatik klasik anahtarlı çıkış yok |
| Barkeep | Süre, alıcı ve ödeme limitiyle agent harcaması | Oturum verme/yenileme ve para çekmede hybrid insan + PQ yetkilendirmesi |
| ARCANUM | Agent politikaları, harcama sınırları, insan onayları ve dondurma | Daha küçük kapsamlı, açık hybrid imza modeli ve tek oturum için ölçülebilir risk sınırı |
| ArcAgent Pay | Agent ödemelerini kontratta limit ve pause ile kontrol etme | Yenilenmeyen oturum bütçesi ve PQ destekli yönetim onayı |

Arc Guard'ın mainnet'teki varlığı ve bir PQ çekimi 29 Eylül'de RPC üzerinden doğrulandı. Barkeep ve ARCANUM'un yayımladığı mainnet factory adreslerinde kod bulundu. Bu kontroller bağımsız güvenlik denetimi değildir.

ArcMandate'in farkı yalnızca freeze veya yalnızca harcama limiti değildir. Fark, sınırlı sıcak anahtar yetkisini, kritik yönetim işlemlerindeki hybrid onayla birleştirmektir. Bu birleşimin dünyada ilk olduğu iddia edilmeyecek. Başvuru öncesinde rakip taraması yenilenecek.

### Neden PQ?

Bugünkü anahtar sızıntısına karşı esas koruma, yetki ayrımı ve kontrat limitleridir. Donanım cüzdanında saklanan ayrı ECDSA yönetim anahtarı da bugün bu işin önemli bölümünü yapabilir.

PQ katmanı, uzun ömürlü yönetim yetkisini yalnızca klasik imza güvenliğine bağlamamayı sağlar. Arc'ın hazır doğrulayıcısı bu ikinci kriptografik kontrolü uygulanabilir hale getirir. Bu fayda, anahtarların ayrı ve doğru saklanması varsayımına dayanır.

ECDSA mesajları da zincir dışında imzalanabilir ve relay edilebilir; bu özellikler PQ'ya özgü diye sunulmayacak. Public key ve kullanılmış imzalar zincirde görünür. Ürün gizlilik sağlamaz.

## 3. Roller ve yetkiler

Üç ayrı anahtar/rol bulunur:

- **İnsan owner wallet'ı:** Normal EVM wallet. Agent sunucusunda tutulmaz.
- **Agent wallet'ı:** Oturum boyunca sınırlandırılmış ödemeleri gönderen sıcak anahtar. Owner ile aynı adres olamaz.
- **PQ anahtarı:** Kullanıcının SLH-DSA anahtarı. Agent'a veya sunucuya verilmez.

| İşlem | Yetki | MVP davranışı |
|---|---|---|
| Kasaya USDC yatırma | Fon sahibinin transfer onayı | Oturum bütçesini değiştirmez |
| Limit içi ödeme | Aktif agent wallet'ı | Bütçe, süre, alıcı, işlem kimliği ve oturum kontrol edilir |
| Limit üstü ödeme | Agent yapamaz | Çağrı revert olur; otomatik onay talebi oluşmaz |
| Yeni oturum açma / mevcut oturumu değiştirme | Owner transaction + PQ imzası | Eski oturum tamamen iptal edilir; yeni şartlar açıkça onaylanır |
| Acil durdurma | Owner transaction **veya** PQ imzası | İki yol da sadece yetki azaltır; para göndermez |
| Kasadan para çekme | Owner transaction + PQ imzası | Agent oturumu durdurulmuşken, imzalanan alıcıya ve tutara |
| Eski oturumu tekrar açma | Yok | Yeni oturum ve yeni hybrid onay gerekir |
| Owner/PQ anahtarı değiştirme | MVP'de yok | İki anahtar erişilebilirken yeni vault'a migration |

Owner'ın normal transaction imzası klasik onayı sağlar; kontrat `msg.sender == owner` denetler. Bu sürüm owner için ayrıca EIP-712 mesaj imzası istemez. PQ imzası aynı işlemin kesin parametrelerini bağlar.

**Relay sınırı:** PQ ile freeze işlemini herhangi bir fonlanmış wallet gönderebilir. Yeni oturum ve çekim işlemlerini MVP'de owner gönderir. Tüm işlemler için “herkes relay edebilir” denmeyecek.

## 4. Gerçek zarar sınırı

“En fazla günlük limit kadar kayıp” iddiası kullanılmayacak. Günlük limit yenilenir; bir saldırgan birden çok günde veya gün sınırında tekrar harcayabilir.

MVP oturumu şu alanlarla tanımlanır:

```text
Agent:           belirli bir EVM adresi
Toplam bütçe:    1,00 USDC — otomatik yenilenmez
İşlem limiti:    0,10 USDC
Süre sonu:      belirli bir Unix timestamp
Alıcı listesi:  en fazla 5 belirli adres
```

Aktif oturum için:

```text
remainingBudget = totalBudget - spent
```

Agent anahtarı tek başına ele geçirildiğinde, yeni insan onayı verilmediği ve kontrat doğru çalıştığı varsayımıyla, o oturumdan kalan yetkisiz transferlerin toplamı `remainingBudget` değerini aşamaz. Alıcı listesi de her ödemede geçerlidir. Bu ifade gas masraflarını, owner tarafından ayrıca onaylanmış işlemleri, kontrat hatasını veya iki yönetim anahtarının ele geçirilmesini kapsamaz.

Kasadaki bakiye düşükken üst sınır ayrıca mevcut bakiyeyle sınırlıdır; sonradan gelen deposit harcanmamış yetkiyi kullanılabilir hale getirebilir ama oturum bütçesini artırmaz. Bu nedenle arayüz hem kasa bakiyesini hem kalan **yetkiyi** ayrı gösterir.

Freeze zincire girmeden önce saldırgan kalan bütçeyi kullanabilir. Freeze geçmiş ödemeleri geri almaz. Bir transaction'ın sıralamasında freeze sonrasına kalan eski oturum ödemeleri reddedilir.

Agent wallet'ında gas için tuttuğumuz USDC de çalınabilir; bu ayrı bakiyeyi yalnızca operasyon için gereken küçük miktarda tutarız. MVP vault'tan agent'a otomatik gas aktarmaz.

## 5. Oturum yaşam döngüsü ve eski işlemler

```text
Kurulum / oturum yok
        ↓ owner + PQ: startSession
Aktif oturum
        ├─ bütçe biter → ödeme yapılamaz
        ├─ süre dolar → ödeme yapılamaz
        ├─ freeze → oturum kalıcı olarak iptal
        └─ owner + PQ: startSession → önceki oturum iptal, yenisi başlar
```

- Aynı vault'ta tek aktif oturum bulunur.
- Her yeni oturum farklı `sessionId` taşır; mevcut oturumun alanları yerinde gevşetilmez.
- Freeze mevcut oturumu kapatır ve oturum sürümünü ilerletir. Yeni oturum eski hakları diriltmez.
- `agentPay` beklenen `sessionId` içerir. Eski agent aynı adresle yeniden yetkilendirilse bile eski işlem yeni bütçeye taşınamaz.
- `startSession` eski oturumun kalan bütçesine ekleme yapmaz; yeni toplam yetkiyi belirler. Arayüz eski/yeni alıcıları, süreyi ve bütçeyi birlikte gösterir.
- Oturum yenileme otomatik yapılmaz. “Sürekli yetki ver” seçeneği MVP'de yoktur.
- Süre dolması state'i kendiliğinden yazmaz; kontrat her ödeme anında `block.timestamp < expiresAt` kontrol eder. Arayüz zincir zamanını esas alır.

## 6. MVP kapsamı ve ekranlar

### Zorunlu teslim kapsamı

1. Owner wallet bağlama ve Arc ağ kontrolü.
2. PQ anahtar üretme; şifreli backup dışa aktarma ve geri yükleme denemesi.
3. Kullanıcıya ait immutable vault deploy etme; ilk durumda agent yetkisi kapalı.
4. ERC-20 USDC transferiyle kasayı fonlama ve hybrid onayla çekme.
5. Owner + PQ ile oturum oluşturma/değiştirme.
6. Node tabanlı örnek agent ile gerçek USDC ödemesi.
7. Yetki ihlallerini reddetme ve gerekçelerini gösterme.
8. Owner veya PQ ile acil durdurma.
9. Oturum, kalan bütçe, alıcı listesi ve transaction kanıtlarını gösteren tek yönetim ekranı.
10. Wallet bağlamadan açılan, gerçek demo vault durumunu ve işlem kanıtlarını gösteren salt okunur görünüm; aynı sayfanın modu.

### İş yükünü azaltan kesin kararlar

| Bileşen | İlk teslim kararı | Korunan değer |
|---|---|---|
| PQ imzalama | Tarayıcıda tek Worker; ayrı offline uygulama yok | Gerçek Arc PQ doğrulaması |
| Anahtar saklama | Tek şifreli dosya export/import akışı ve geri yükleme kontrolü | Kullanıcının tekrar imza atabilmesi |
| Arayüz | Bir sayfa, sade formlar, bakiye ve işlem bağlantıları | Kullanılabilir ve anlaşılır demo |
| Agent | Terminalden çalışan TypeScript ödeme istemcisi | Gerçek bağımsız agent wallet'ından ödeme |
| Dağıtım | Derlenmiş artifact ile doğrudan vault deploy; factory yok | Kullanıcıya ait ayrı vault |
| Fonlama | USDC kontratında `transfer(vault, amount)` | Tek transferle fonlama; ayrıca allowance yönetimi gerekmez |
| Veri okuma | RPC, kontrat getter'ları ve sınırlı event sorgusu | Zincirdeki gerçek durumu gösterme |
| İşlem kanıtı | Demo script'inin ürettiği public işlem manifesti | Jürinin akışı tekrar kontrol edebilmesi |

MVP için backend, veritabanı, indexer, kullanıcı hesabı, relayer servisi ve LLM entegrasyonu gerekmiyor. Demo agent'ın private key'i kullanıcı arayüzüne aktarılmaz; yerel script'te tutulur.

### Kapsam dışında

- Ayrı cihaz/offline signer paketi, işlem JSON'u taşıma ve QR akışı.
- Grafikler, özel animasyonlar, çok sayfalı dashboard, kapsamlı geçmiş taraması ve bildirimler.
- Gelişmiş backup sihirbazı, bulut yedekleme ve otomatik anahtar kurtarma.
- Onchain bekleyen talepler kuyruğu ve özel büyük ödeme onayı.
- Günlük/aylık otomatik limit sıfırlama.
- Çoklu agent, çoklu token, DeFi, yield, bridge ve keyfi kontrat çağrıları.
- `approve`, `delegatecall`, modül yükleme veya vault'tan genel amaçlı `execute`.
- Relayer sunucusu, gas sponsorship ve agent gas'ını kasadan karşılama.
- Guardian ağı, kayıp anahtar kurtarması, admin backdoor veya upgrade proxy.
- Üretim seviyesinde custody, sigorta veya bağımsız audit iddiası.

Kapsam özellikle küçüktür. Büyük ödemeler için owner mevcut oturumu değiştirir veya doğrudan hybrid çekim yapar. “Revert oldu ve talep kaydedildi” gibi çelişkili bir akış yoktur. Gelecekte talep kuyruğu eklenirse ayrı işlem veya zincir dışı imzalı talep olarak tasarlanır.

### Tek sayfalık kullanıcı akışı

1. **Kurulum:** Wallet bağla → Arc ağını doğrula → PQ anahtarı üret → şifreli dosyayı indir ve yeniden aç → doğrulamayı geçir → vault oluştur.
2. **Fonla:** Tutarı gir → USDC transferini onayla → receipt sonrası güncel bakiyeyi göster.
3. **Yetki ver:** Agent, toplam bütçe, işlem tavanı, alıcılar ve süreyi gir → okunabilir özeti onayla → PQ imzasını oluştur → owner wallet işlemini gönder.
4. **İzle ve durdur:** Kalan yetkiyi izle → owner ile hızlı durdur veya PQ ile durdur. PQ yolunda işlemi gönderen bağlı wallet owner olmak zorunda değildir.
5. **Çek veya yeniden başla:** Durdurma sonrası wallet + PQ ile çekim ya da yeni oturum; yeni oturum için açıkça yeni bütçe onaylanır.

PQ dosyası yönetim için gerektiğinde açılır; kullanıcı her yönetim işleminde parametreleri onaylar. Agent çalışması PQ dosyasının açık kalmasına bağlı değildir. Demo script'ini başlatmak için README'de tek komut bulunur; tarayıcıya script başlatan bir sunucu eklenmez.

### Ekrandaki bilgiler

- Kasa bakiyesi; aktif yetki durumu.
- Kalan toplam oturum bütçesi ve sona erme zamanı.
- Agent adresi, alıcı listesi, işlem başına tavan.
- “Yetki ver”, “Durdur”, “Para çek” eylemleri.
- Mevcut oturumun son işlemleri ve gerçek receipt bağlantıları; tüm ağ geçmişini indeksleme yok.
- “Simülasyonda reddedildi” ile “zincirde revert oldu” durumlarının açık ayrımı.
- Her önemli işlem öncesi güncel USDC gas tahmini.

Arayüzde “Wallet onayı” ve “Güvenlik anahtarı onayı” yazılır. Teknik ayrıntılar aynı sayfadaki açılır kanıt bölümünde yer alır. İşlem durumları hazırlanıyor, imzalanıyor, gönderildi, onaylandı veya reddedildi olarak gösterilir. Sade bir görsel düzen, açık hata metinleri ve kesilmeyen explorer bağlantıları teslim kalitesinin parçasıdır.

## 7. Kontrat taslağı

**Tek çekirdek kontrat:** `ArcMandateVault.sol`. Bir kullanıcıya ait ayrı deployment. İlk teslimde proxy ve factory yok. Constructor owner, PQ public key ve Arc USDC adresini doğrular; ilk oturum kapalıdır.

Başlıca alanlar:

```text
immutable owner
immutable bytes32 pqPublicKey
immutable usdc
controlNonce
sessionId
active
agent
totalBudget
spent
perTxCap
expiresAt
allowlist (sessionId ile ayrıştırılmış)
usedPaymentIds (sessionId ile ayrıştırılmış)
```

Fonksiyon sorumlulukları:

| Fonksiyon | Kontroller ve etkiler |
|---|---|
| `startSession(policy, nonce, deadline, pqSig)` | Owner çağırır; PQ tam policy'yi onaylar; eski oturum iptal; yeni sessionId, spent=0 |
| `agentPay(expectedSessionId, paymentId, to, amount)` | Agent, aktiflik, süre, allowlist, cap, toplam bütçe ve tekrar kontrolü |
| `freezeByOwner()` | Yalnız owner; aktif oturumu kapatır; sessionId ve controlNonce ilerler |
| `freezeByPQ(nonce, deadline, pqSig)` | Herkes gönderebilir; PQ doğrulamasıyla aynı iptal etkisi |
| `withdraw(to, amount, nonce, deadline, pqSig)` | Owner + PQ; `active=false`; imzalanan tutar/alıcı; nonce tüketilir |
| `policyStatus()` / digest view'ları | Arayüz ve test script'leri için okunabilir durum ve mesaj desteği |

Fonlama vault üzerinde ayrı bir `deposit` fonksiyonu gerektirmez: arayüz USDC kontratının `transfer(vault, amount)` çağrısını kullanır. Bakiye `balanceOf(vault)` ile okunur; doğrudan gelen fonlar da aynı şekilde sayılır. UI native coin transferi ile ERC-20 fonlama akışını karıştırmaz.

`SessionStarted`, `AgentPaid`, `SessionRevoked` ve `Withdrawn` event'leri ilgili sessionId, tutar/alıcı ve işlem kimliğini içerir. Demo manifesti public kontrat/transaction verisini kaydeder; secret key içermez.

Kurallar:

- 32 byte PQ public key Solidity'de `bytes32 immutable` olarak tutulur; dinamik `bytes immutable` kullanılamaz. Verifier çağrısında key, tam 32 byte olarak encode edilir.
- Bütçe ve cap pozitif; `perTxCap <= totalBudget`; expiry gelecekte; alıcı listesi boş değil ve en fazla 5.
- Agent ve owner farklı; sıfır adresler reddedilir. MVP alıcıları EOA veya kontrat olabilir, ancak ödeme yalnızca USDC transferidir.
- Tutarlar ERC-20 tarafında 6 decimal integer; JavaScript floating point kullanılmaz. Gas 18 decimal native birimdedir.
- `agentPay` için `amount > 0` ve `amount <= totalBudget - spent` şarttır.
- `spent` ve paymentId kaydı dış çağrıdan önce güncellenir. Transfer başarısızsa tüm işlem atomik olarak geri alınır.
- SafeERC20 ve reentrancy koruması kullanılır; dış servisin sözüne göre ödeme başarılı sayılmaz.
- Global sınırsız döngüler yoktur. Allowlist ve ödeme kimlikleri sessionId ile ayrıldığı için eski kayıtları silmek gerekmez.
- Gas agent/owner/relay wallet'ından çıkar; vault gas geri ödemez.
- Token ve recipient blocklist kaynaklı hatalar normal işlem başarısızlığı olarak ele alınır. Ön kontrol yapılması execution anındaki hatayı ortadan kaldırmaz.
- Agent ödemeleri `controlNonce` tüketmez; agent yönetim imzalarını harcayarak engelleyemez.
- Tekrar freeze, aktif oturum yoksa revert olur; sınırsız nonce ilerletme yolu oluşturulmaz.

### Payment ID neden var?

RPC timeout'u, işlemin başarısız olduğu anlamına gelmez. Agent önce receipt/state sorgular; gerekiyorsa aynı `paymentId` ile yeniden dener. Kontrat aynı oturumdaki aynı kimliği ikinci kez ödeyemez. Her retry'da yeni kimlik üretmek yasaktır. Ödeme gerçekleşmesi, API hizmetinin teslim edildiğini kanıtlamaz; otomatik teslim/refund protokolü MVP'de yoktur.

## 8. İmza ve replay kuralları

Her yönetim işlemi aşağıdaki alanları bağlayan tek bir canonical digest kullanır:

```text
domain = ArcMandate + version
chainId
vaultAddress
owner
actionType (START_SESSION / FREEZE / WITHDRAW)
controlNonce
currentSessionId
deadline
paramsHash
```

- Digest için sabit şema ve `abi.encode` kullanılır; belirsiz string birleştirme yapılmaz.
- Oturum parametreleri agent, totalBudget, perTxCap, expiresAt ve alıcı listesinin tamamını içerir. Alıcılar canonical sıraya konur, tekrarlar reddedilir.
- Tarayıcı signer'ı onay ekranındaki yapılandırılmış parametrelerden digest üretir; UI, script ve testler aynı küçük TypeScript kodlama modülünü kullanır. Kontratla uyum bağımsız test vektörüyle kontrol edilir. Bu paylaşım format hatalarını azaltır; kötü amaçlı frontend'e karşı bağımsız cihaz güvencesi sağlamaz.
- Digest'in 32 ham byte'ı SLH-DSA-SHA2-128s ile imzalanır; hex metnin UTF-8 byte'larıyla karıştırılmaz.
- Arc precompile adresi: `0x1800000000000000000000000000000000000004`.
- İmza varyantı/context ve kütüphane sürümü sabitlenir. JS ile kontrat arasında ortak test vektörleri tutulur.
- Public key 32, imza 7.856 byte olmalı. Precompile hatası/eksik yanıtı başarısız sayılır.
- Başarılı yönetim işlemi nonce'u tüketir. Freeze nonce'u ilerleterek önceden imzalanmış yeniden yetkilendirme/çekim işlemlerini de geçersiz kılar.
- StartSession da nonce'u ilerletir. Daha eski freeze imzası yeni oturumu durduramaz; güncel durum için yeniden imza gerekir.
- Aynı anda hazırlanmış iki yönetim imzasından ilki başarılı olursa ikincisi yeniden hazırlanmalıdır; UI bu durumu gösterir.

Bu nonce tasarımı aynı anahtarların ele geçirilmediği varsayımıyla eski imzaları iptal eder. Freeze'den önce zincire giren geçerli bir işlemi geri alamaz.

## 9. PQ signer ve backup

Web uygulaması: TypeScript + Vite/React + viem. İlk sürüm tek bir EIP-1193 tarayıcı wallet bağlantısını hedefler; kapsamlı wallet sağlayıcı matrisi yok. İmzalama: Web Worker içinde sürümü sabitlenmiş `@noble/post-quantum`. Kontrat geliştirme ve testleri için Foundry; iki farklı kontrat test altyapısı kurulmaz.

Repo dört küçük parçadan oluşur: kontrat/testler, web, ortak işlem kodlama modülü ve agent/demo script'leri. Ortak modül repo içi kullanılır; yayınlanmış SDK hazırlamak MVP işi değildir. ABI/artifact elle kopyalanmak yerine build çıktısından alınır.

Backup biçimi: version, algoritma, public key, KDF parametreleri/salt, AES-GCM nonce ve şifreli secret key. Anahtar şifreleme için incelenmiş scrypt ve AES-256-GCM implementasyonları kullanılır; kendi kriptografi algoritmamız yazılmaz. Import edilen KDF parametrelerine kaynak tüketimi üst sınırı konur.

- CSPRNG ile bağımsız PQ anahtarı oluşturulur; wallet'ın herkese açık imzasından PQ secret türetilmez.
- Düz secret localStorage, log, analytics veya sunucuya yazılmaz.
- Şifreli dosya kaydedildikten sonra kullanıcıdan dosyayı yeniden açması istenir; secret'tan türetilen public key eşleşmesi ve yerel deneme imzası doğrulanır. Yanlış parola veya bozuk dosya ile fonlama adımına geçilmez. Bu UI kontrolü kontrata dışarıdan para gönderilmesini engellemez.
- Parola, indirilmiş dosyayı korur. Kullanıcının dosyayı açtığı cihaz ele geçirilmişse korumayı garanti etmez.
- JavaScript belleğini kesin biçimde silme garantisi verilmez; oturum kapatma ve Worker sonlandırma yalnızca maruziyeti azaltır.
- İmza işlemi sırasında aşama ve süre gösterilir; gerçek ilerleme ölçülemiyorsa sahte yüzde gösterilmez.

### MVP'de tarayıcı kullanımı; offline signer sonraki sürümde

MVP imzayı kullanıcının tarayıcısında oluşturur. Secret key sunucuya gönderilmez; şifreli dosya açıldığında secret geçici olarak tarayıcı belleğinde bulunur. Bu sürüm “offline anahtar” veya “ayrı cihaz güvenliği” diye tanıtılmaz. Wallet ve PQ anahtarı aynı cihazdayken cihazın ele geçirilmesi iki onayı da tehlikeye atabilir.

Ayrı offline signer, işlem dosyası aktarımı ve iki cihaz testi başvuru sonrasına taşındı. Bu karar imza biçimini veya kontrattaki hybrid yetkiyi değiştirmez. İleride aynı işlem şemasını kullanan offline signer eklenebilir; bu sürüm için ayrıca imza import/export arayüzü yapılmaz.

### Kayıp anahtar kararı

MVP'de ECDSA-only zaman kilitli çıkış ve ayrı recovery anahtarı yoktur. PQ dosyasının bütün kopyaları/parolası kaybolursa veya owner anahtarına erişim kalmazsa hybrid çekim yapılamaz. Eldeki tek anahtar aktif agent oturumunu durdurabilir ama parayı tek başına çıkaramaz.

Bu gerçek bir kullanılabilirlik bedelidir. Backup denemesi yapılmadan fonlama akışına geçilmez. İki anahtar hâlâ erişilebilirken yeni anahtarlarla yeni vault oluşturup hybrid çekim yoluyla migration yapılabilir. Prototipte küçük demo fonları kullanılır.

## 10. Tehdit modeli ve eksikler

| Durum | Beklenen davranış / kalan risk |
|---|---|
| Agent anahtarı ele geçirilir | Kalan oturum bütçesi, alıcılar ve süre geçerlidir; agent yönetim yapamaz |
| Owner anahtarı tek başına ele geçirilir | Oturumu durdurarak hizmet kesintisi yaratabilir; PQ olmadan bütçe artıramaz/çekemez |
| PQ anahtarı tek başına ele geçirilir | Freeze yapabilir; owner olmadan para çıkaramaz/yeni oturum veremez |
| Her iki yönetim anahtarı ele geçirilir | Koruma aşılır |
| UI veya yönetim cihazı ele geçirilir | Tarayıcı signer'ı bağımsız güven sınırı değildir; iki anahtar da erişilebilirse hybrid koruma aşılabilir |
| Alıcı izinli ama hizmeti teslim etmez | Harcama gerçekleşebilir; allowlist kalite veya teslim garantisi değildir |
| Freeze henüz zincire girmedi | Önce sıralanan ödemeler kalan yetkiyi kullanabilir |
| Eski transaction yeni oturumda gönderilir | sessionId uyuşmazlığı nedeniyle reddedilir |
| RPC kesilir / site kapanır | Kontrat kuralları sürer; kaynak koddan aynı web arayüzünü yerelde çalıştırma ve RPC değiştirme belgelenir; bağımsız recovery uygulaması MVP'de yok |
| USDC blocklist / ağ sorunu | PQ katmanı çözmez; işlemler engellenebilir |
| Kütüphane veya kontrat hatası | İmza standardı tek başına korumaz; audit olmadan üretim güvenliği iddia edilmez |

`@noble/post-quantum` bağımsız audit ve constant-time garantisi açısından sınırlamalar açıklıyor. Algoritmanın standart olması, signer uygulamasının veya ArcMandate'in denetlenmiş olduğu anlamına gelmez.

Arc'taki uygulama katmanı PQ doğrulaması bütün ağı, native wallet işlemlerini veya USDC altyapısını kuantuma dayanıklı yapmaz. “Quantum-proof”, “kesin güvenli” ve “kuantum bilgisayarla bile taklit edilemez” ifadeleri kullanılmaz.

## 11. Test ve kabul şartları

Kontrat testleri geliştirmeyle birlikte yazılır. Foundry'de hızlı birim/fuzz testleri, ardından gerçek Arc precompile'ını çağıran entegrasyon script'i kullanılır. Standart yerel EVM'de doğrulayıcı için mock kullanılabilir; Arc uyumluluğu gerçek ağda ayrıca kanıtlanır. Özel node veya ek test altyapısı kurmak ilk teslimin şartı değildir.

### Kritik testler

- Yetkisiz caller; owner/agent ayrımı; kapalı oturum.
- Tek işlem tavanı, toplam bütçe sınırı, sıfır tutar ve tam sınırdaki tutarlar.
- Parçalanmış çoklu ödemelerin toplam bütçeyi aşamaması.
- Gece yarısı/gün değişiminde bütçenin yenilenmemesi.
- Ek deposit'in harcama yetkisini artırmaması.
- Expiry'nin hemen öncesi ve tam expiry anı.
- Alıcı listesi dışında ödeme; duplicate alıcı ve liste uzunluğu sınırı.
- Aynı paymentId'nin yeniden kullanılması; başarısız transferin bütçeyi tüketmemesi.
- Yanlış PQ imzası, bozuk boyut, farklı mesaj, yanlış domain/chain/vault/action/nonce/deadline.
- Owner tek başına ve PQ tek başına withdrawal/startSession yapamaması.
- Her iki freeze yolu; tekrarlanan freeze; freeze sonrası ödeme ve eski yönetim imzaları.
- Yeni session'da eski agent işlemleri; aynı agent adresinin tekrar atanması.
- Aktifken çekimin reddi; freeze sonrası doğru hybrid çekim.
- Transfer hatası/reentrancy girişiminde state tutarlılığı.
- Backup import/export, yanlış parola, bozuk dosya, public key uyuşmazlığı ve geri yüklenen anahtarla imza doğrulama.

### Değişmez kurallar

1. Her oturumda `spent <= totalBudget`.
2. Agent'ın gerçekleştirdiği her transfer, işlem anında geçerli oturum kurallarını sağlamıştır.
3. Agent işlemleri yönetim yetkisini genişletemez.
4. Freeze ile iptal edilen oturum tekrar etkinleşmez.
5. Deposit, kalan oturum yetkisini yükseltemez.
6. Başarısız transfer state'i ve ödeme kimliğini tüketmez.
7. Owner + PQ onayı olmadan yeni harcama oturumu veya kullanıcı çekimi gerçekleşemez.

Mainnet kabulü: küçük gerçek USDC ile başarılı ödeme, reddedilen ihlal, freeze, eski oturum reddi ve hybrid çekim transaction'ları yayımlanır. Reddedilen işlemi cüzdan simülasyonu zincire göndermediyse bu durum açık yazılır; revert receipt varmış gibi gösterilmez.

### Teslim kapıları

| Kapı | Geçiş kanıtı | Geçmezse yapılacak iş |
|---|---|---|
| A — PQ uyumu | Gerçek Arc verifier geçerli imzayı kabul, değiştirilmiş mesajı reddediyor; Worker aynı biçimde imzalıyor | Arayüz geliştirmesini büyütmeden format/ABI sorununu çöz |
| B — Yetki modeli | Temel akış ve kritik testler geçiyor; tekrar/replay ve bütçe sınırları doğrulanmış | Kontrat hatasını çöz; yeni özellik ekleme |
| C — Kullanılabilirlik | Temiz tarayıcı oturumunda şifreli dosyayı geri yükleyip fonlama, yetki, freeze ve çekim yapılabiliyor | Anahtar/işlem akışını düzelt |
| D — Başvuru | Canlı mainnet adresi, çalışan arayüz, public repo, gerçek kanıtlar ve kısa demo açılıyor | Eksik kanıt veya dağıtımı tamamla |

Küçük tutarlı mainnet denemesinden önce A–C geçer. Başvuru ancak D geçince yapılır. Aynı hatayı farklı ekranlarda tekrar test eden geniş bir UI test paketi yerine kritik akış için bir tarayıcı smoke testi yeterlidir; kontrat test kapsamı bundan bağımsızdır.

## 12. 60–90 saniyelik demo

Kurulum ve funding önceden yapılabilir; bunların transaction linkleri de gösterilir.

1. Kasada **1 USDC** var. Kullanıcı **0,15 USDC toplam**, **0,05 USDC işlem başı**, 15 dakika ve belirli alıcı için oturum açar. Wallet + PQ onayı görünür.
2. Örnek agent 0,05 USDC öder. Kalan yetki **0,10 USDC**, kasada **0,95 USDC** görünür.
3. Agent 0,20 USDC ister; limit nedeniyle reddedilir. Para hareket etmez. Toplam bütçeyi küçük ödemelerle aşma denemesi ayrıca otomatik testte kanıtlanır.
4. Agent anahtarının ele geçirildiği simüle edilir. Owner'dan farklı bir relay wallet'ı, geçerli PQ freeze imzasını gönderir.
5. Freeze öncesinde kurallara uygun olan 0,05 USDC'lik ödeme, eski sessionId ile gönderildiğinde reddedilir. Böylece ret sebebi tutar sınırı değil, yetkinin iptalidir.
6. Owner + PQ ile yeni oturum açılır. Eski oturumun işlemi yine reddedilir; yeni oturum işlemi başarılı olur. Ekran aynı agent adresi tekrar kullanılsa bile eski işlemin dirilmediğini gösterir.

Eski oturum denemesi, güncel wallet transaction nonce'u ile eski `sessionId` içeren çağrı olarak yapılır. Ret sebebi kontrattaki oturum kontrolü olmalıdır; daha önce kullanılmış wallet nonce'u nedeniyle ağın reddetmesi bu özelliği kanıtlamaz. Yeni oturum testinde alıcı, tutar ve süre geçerli tutulur.

Hybrid çekim de mainnet kanıt paketinde zorunludur: yeni oturum durdurulur, kalan demo fonu owner + PQ ile çekilir. Video süresi yetmezse bu bölümün receipt'i aynı kanıt panelinde sunulur. Kurulum, yedekten geri yükleme ve uzun imzalama beklemeleri video dışında yapılabilir; kesmeler açık olmalı. Demo sonunda kalan risk yetkisi açık bırakılmaz.

Demo'nun başlığı: **“Agent anahtarın çalınsa da yetkinin sınırı kontratta kalır.”**

Örnek agent bir Node/TypeScript programıdır; otomatik USDC ödeme istemcisi olduğu açıkça söylenir. LLM şart değil. İşlevsiz bir “AI” etiketi kullanılmaz. Gerçek x402 entegrasyonu sonraki aşamadır; normal transfer demo'su x402 desteği diye sunulmaz.

Jüri salt okunur bağlantıyı açınca wallet bağlamadan bakiye, oturum durumu ve adım adım mainnet kanıtlarını görebilir. Denemek isteyen geliştirici README komutuyla kendi agent'ını çalıştırır. Jüriye demo private key'i verilmez ve halka açık sayfaya bizim fonlarımızı harcatacak otomatik işlem düğmesi konmaz.

## 13. Gas ve operasyon maliyeti

28 Eylül'deki salt okunur mainnet ölçümü: geçerli PQ doğrulama çağrısı yaklaşık **382.516 gas**, o anki 20 gwei fiyatla **0,00765 USDC** tahmin edildi. Bu bir ArcMandate işlem receipt'i değildir.

29 Eylül'de bağımsız kontrol edilen Arc Guard çekimi: **451.246 gas**, receipt'e göre **0,009476166 USDC**. Bu da başka projenin ölçümüdür.

ArcMandate'te PQ doğrulama her küçük ödemede çalışmaz; yeni oturum, PQ freeze ve çekimde çalışır. Agent ödemelerinde standart kontrat kontrolleri vardır. Kesin ArcMandate gas maliyetleri implementasyondan sonra ölçülecek; deployment ücretine şimdiden sabit cent garantisi verilmeyecek.

Uygulama ücreti MVP'de sıfırdır; ağ ücreti işlemi gönderen wallet tarafından ödenir. Gas fiyatı sabit değildir. Arayüz güncel gas tahminini gösterir; son ücret onayı wallet'ta yapılır. Özel gas ayar ekranı geliştirilmez.

## 14. Takvim ve öncelik

| Tarih | İş | Çıkış şartı |
|---|---|---|
| 29–30 Eylül | Kapsam, kontrat iskeleti, ortak işlem şeması; gerçek verifier ve tarayıcı Worker denemesi | Kapı A; önceki PQ denemesi ürün imza şemasıyla tekrar doğrulandı |
| 1–2 Ekim | Session, agentPay, hybrid kontrol, iki freeze yolu ve withdrawal; beraberinde testler | Kapı B; temel uçtan uca akış script'te çalışıyor |
| 3–4 Ekim | Tek sayfa UI, şifreli export/import, doğrudan deploy ve fonlama | Anahtar geri yükleme ve yönetim akışı çalışıyor |
| 5 Ekim | Agent/demo script'i, receipt manifesti, read-only görünüm; testnet smoke testi | Kapı C; temiz kurulumdan tekrar edilebilir demo |
| 6 Ekim | Kontrat ve imza akışını yeniden inceleme, eksik testler ve düzeltmeler; README taslağı | Kritik hata yok; tehdit modeli açık; bu inceleme bağımsız audit olarak sunulmaz |
| 7 Ekim | Küçük fonla mainnet deployment, demo ve gas ölçümü | Gerçek işlem kanıtları; fon çekimi de başarılı |
| 8 Ekim | Kısa video, public repo, son link kontrolü ve başvuru | Kapı D geçiyorsa gönderim |
| 9–11 Ekim | Gecikme varsa kalan hataları bitirme ve başvuru | İç son hedef 11 Ekim; kapsam artmaz |
| 12–14 Ekim | Son teknik/başvuru sorunları için tampon | Yalnız düzeltme; son güne yeni dağıtım bırakılmaz |

Bu, her gün düzenli ve yoğun çalışma varsayımıyla hazırlanmış hedeftir. 9–11 etkin geliştirme günü bir tahmindir; ilk Solidity deneyimi veya entegrasyon sorunları 2–3 gün ekleyebilir. Öğrenme payı ile tampon aynı günlerdir; ikisi ayrı ayrı varmış gibi sayılmaz. 8 Ekim hedefi kalite kapılarından önce gelmez.

### Gecikme halinde kırpma sırası

1. Özel görsel tasarım, animasyon, ek wallet desteği ve İngilizce dışındaki UI dilleri yapılmaz.
2. Geniş event geçmişi çıkarılır; mevcut durum, son işlemler ve demo manifesti kalır.
3. Arayüzden deploy yetişmezse belgelenmiş script ile kişisel vault oluşturma ve UI'da adresle açma kullanılır. Çalışan public demo ve temel yönetim ekranı kalır; self-service deploy özelliği başvuru metninden çıkarılır.
4. Tek seferlik deploy veya kurulum komutları terminalde kalabilir. Yönetim ekranındaki yetki verme, durdurma ve çekme tamamlanır.

**Kırpılmayacaklar:** Yenilenmeyen toplam bütçe, alıcı/süre/işlem sınırları, hybrid yetki, iki freeze yolu, session/nonce replay koruması, paymentId, şifreli export/import ve geri yükleme testi, kritik kontrat testleri, gerçek Arc verifier ve mainnet kanıtları.

Bu listenin temel bir maddesi çalışmıyorsa özellik tamamlanmış gibi başvuru yapılmaz. Offline signer, x402 ve çoklu agent tampon günlerinde açılacak ek işler değildir.

## 15. Ödül için teslim paketi

- Canlı mainnet dApp ve kaynak kodu.
- Public builder profili (GitHub, X veya Farcaster) ve programın istediği kısa açıklama.
- 60–90 saniyelik video; kolay erişilen read-only demo durumu.
- Kontrat adresi, chain ID, derleme sürümü, deployment ve demo transaction hash'leri.
- Kısa README: problem, kullanıcı, nasıl denenir, Arc'a özgü bileşen, rakiplerden fark.
- `THREAT-MODEL.md`: anahtar kaybı, freeze sıralaması, risk sınırı ve kapsam dışı tehditler.
- Test çıktıları; gerçek ağ entegrasyonu ile mock testlerin ayrımı.
- Signer sürümü ve ortak imza test vektörü.
- Arc Guard ve diğer kaynaklara dürüst atıf; kod alınırsa lisans/NOTICE yükümlülükleri korunur.

Microgrant değerlendirmesi Arc ilişkisi, teknik güvenilirlik, yapılan işin kalitesi ve devam potansiyeline bakıyor. Yalnız testnet veya tasarım sunumu yeterli değil. Çalışan mainnet proje ve public repo gerekiyor. Kazanma yüzdesi verilemez; basitlik tek başına düşük rekabet anlamına gelmez.

### Jüriye gösterilecek somut karşılıklar

| Değerlendirme alanı | İlk teslimde sunacağımız kanıt |
|---|---|
| Arc ile ilişkisi | Native PQ precompile ile doğrulanmış yönetim işlemi ve USDC ödemesi |
| Teknik güvenilirlik | Bütçe, hybrid yetki, replay ve anahtar geri yükleme testleri; açık tehdit modeli |
| Yapılan işin kalitesi | Wallet istemeden açılan demo, çalışan formlar, anlaşılır hata durumları ve explorer bağlantıları |
| Devam potansiyeli | Aynı yetki modelinin gerçek x402 ödemelerine ve birden çok agent'a genişleme yolu |

PQ tek başına agent anahtarının çalınmasını önlemez. Bugünkü korumayı toplam bütçe ve rol ayrımı sağlar; PQ ikinci kriptografik yönetim onayıdır. İlk sürümdeki tarayıcı signer'ının sınırını açık anlatmak, ürünün gerekçesinin parçasıdır. Rakip karşılaştırmasında yalnız freeze özelliğiyle özgünlük iddia edilmez.

### Başvuru metni taslağı — uygulanmış özelliklerle son kez eşleştirilecek

> ArcMandate gives software agents time-limited USDC spending authority on Arc. Each session has a non-renewing total budget, a per-payment cap, and an explicit recipient list, enforced by the vault contract. Creating or replacing a session and withdrawing funds require both the human owner's wallet and an SLH-DSA signature verified by Arc's native precompile. Either management key can revoke an active session. Our mainnet demo shows a normal payment, an over-limit rejection, emergency revocation, and an old session's payment remaining invalid after a new session is authorized. The prototype includes browser-based PQ signing and encrypted key export/import, with documented key-loss and device-security limits. The next step is integrating this bounded authority with a real agent payment workflow.

## 16. Sonraki büyük yarışma / ürün yolu

1. **Ayrı cihazda imzalama:** Aynı işlem şemasını kullanan offline signer, okunabilir işlem özeti ve dosya aktarımı; ağ kapalıyken test edilmiş paket.
2. **Gerçek ödeme entegrasyonu:** Bir x402 sağlayıcısından veri/API satın alan agent; ödeme tekrarları ve teslim başarısızlığının açık yönetimi.
3. **Birden çok agent:** Birbirinden bağımsız bütçeler, toplu PQ yetki verme, agent bazlı iptal. Kullanıcı deneyimiyle birlikte toplam risk gösterimi.
4. **SDK:** Başka ürünlerin aynı yetki modelini kullanabileceği TypeScript paket ve örnekler.
5. **Key yönetimi:** Hybrid onaylı key rotation ve tasarlanmış recovery. Recovery, mevcut korumayı sessizce aşmamalı.
6. **Daha geniş wallet entegrasyonu:** ERC-1271/4337 veya mevcut kasa modülleri; ek imza ve bypass yolları yeniden incelenir.
7. **Üretim hazırlığı:** Bağımsız audit, signer güvenliği, kullanıcı testleri ve gerçek geliştirici entegrasyonları.

Gelecekteki yarışmanın mevcut projeleri kabul edip etmediği ayrıca kontrol edilmeli; bu repo için başlangıç tag'i ve yeni yarışma sırasında yapılan değişiklikler belgelenmeli. Bu microgrant'ın mevcut Circle/Arc fonlamasıyla ilgili uygunluk kuralı da başvuru öncesinde yeniden kontrol edilmeli.

## 17. İlk taslağa göre düzeltilenler

| İlk taslaktaki sorun | Bu plandaki karar |
|---|---|
| Günlük limit toplam kayıp tavanı sanılıyor | Yenilenmeyen, süreli toplam oturum bütçesi |
| PQ tek başına para taşıyor/limit artırıyor | Owner + PQ kritik yetki; tek anahtar yalnız durdurabilir |
| Revert aynı anda onay talebi kaydediyor | Talep kuyruğu MVP'den çıktı; revert state kaydetmez |
| Unfreeze eski yetkiyi diriltebilir | Yeni sessionId ile yeni hybrid onay; eski session açılmaz |
| Eski imzalar freeze sonrası geçerli kalabilir | Freeze controlNonce ve sessionId ilerletir |
| İşlem retry'ı çift ödemeye dönüşebilir | Session kapsamında paymentId ve receipt/state kontrolü |
| Deposit agent'ın sınırını büyütebilir | Balance ile yetki birbirinden ayrı tutulur |
| Online dosya import'u offline signing sanılıyor | İlk teslim açıkça tarayıcı signer'ı; offline paket sonraki sürümde |
| Genel “herkes relay eder” iddiası | MVP'de yalnız PQ freeze herkese açık relay |
| “Neden PQ?” cevabı gas ve relayer'a dayanıyor | Farklı kriptografik yönetim kontrolü; klasik alternatif dürüstçe kabul |
| Varsayımsal ödül yüzdesi | Resmî kriterlere göre somut teslim kanıtları |

### v1.1 kapsam güncellemesi

- Ayrı offline signer ve iki cihaz dosya akışı ilk teslimden çıktı.
- Şifreli anahtar yedeği ve gerçek geri yükleme testi korundu; gelişmiş backup arayüzü çıkarıldı.
- Factory, özel deposit fonksiyonu, geniş geçmiş taraması ve özel gas ekranı kapsamdan çıktı.
- Tek sayfa yönetim ve aynı sayfada salt okunur kanıt görünümü seçildi.
- Demo, freeze sonrası yeni oturum açılsa bile eski işlemlerin geçersiz kalmasını gösterecek şekilde güçlendirildi.
- Takvim 8 Ekim hedefi, 11 Ekim iç son hedefi ve 12–14 Ekim tamponuyla yeniden düzenlendi; teslim kapıları eklendi.

## 18. Kaynaklar ve doğrulama notları

Kaynak kontrol tarihi: 29 Eylül 2026. Proje planındaki mimari tercihler bizim önerimizdir; Arc'ın resmî ürün tasarımı değildir.

- [Arc Microgrants — kurallar ve tarihler](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq)
- [Arc — post-quantum security](https://docs.arc.io/arc/concepts/post-quantum-security)
- [Arc — execution layer ve precompile adresleri](https://docs.arc.io/arc/concepts/execution-layer)
- [Circle arc-node — PQ precompile kaynak kodu](https://github.com/circlefin/arc-node/blob/main/crates/pq-precompile/src/lib.rs)
- [Noble post-quantum — kullanım ve güvenlik sınırları](https://github.com/paulmillr/noble-post-quantum)
- [Circle — USDC'nin iki arayüzü](https://www.arc.io/blog/building-with-usdc-on-arc-one-token-two-interfaces)
- [Arc Guard](https://github.com/Jayanthkoppala/arc-guard)
- [Arc Guard — doğrulanan mainnet çekimi](https://explorer.arc.io/tx/0x03ad2f9d33af0b4f57b7172ead2f7b8e96e18b64eccc0df784a48d4ee249135b)
- [Barkeep](https://github.com/barbarosalagoz/barkeep-arc)
- [ARCANUM](https://github.com/bunnyyxtan/ARCANUM)
- [ArcAgent Pay](https://github.com/dushko-kochoski/arcagent-pay)
- [Fuse](https://github.com/ShalyX/fuse-agent-control-plane)

Bu plan, paylaşılan ArcMandate-plan.md ve jüri değerlendirmesini esas alan çalışma planının v1.1 güncellemesidir. Program şartları bu güncellemede yeniden kontrol edildi; rakip ve geçmiş gas bilgileri önceki araştırmanın tarihli bulgularıdır. Plandaki kod, deployment ve testler yapılacak işlerdir; tamamlandıkları iddia edilmemektedir.
