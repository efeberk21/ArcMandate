# ArcMandate — Implementation Plan ve Geliştirici Devir Belgesi

Sürüm: 1.0 · 29 Eylül 2026  
Durum: Uygulanacak teknik şartname. Bu belgedeki kabul maddeleri henüz tamamlanmış sayılmaz.  
Okuyucu: Önceki sohbeti görmeyen geliştirici veya kodlama yapay zekâsı.  
İlgili belge: [Görevler ve takvim](ArcMandate-roadmap.md).

## 0. Belgenin kullanımı

Bu dosya tek başına ürün kapsamını, kontrat davranışını, imza biçimini ve teslim şartlarını tanımlar. Önceki planların teknik belirsizliklerini giderir. Eski dosyalardaki `deposit`, günlük limit, tek PQ anahtarıyla çekim, otomatik unfreeze, offline signer ve bekleyen ödeme talepleri bu sürüme taşınmayacak.

Önce hedef repo ve mevcut kod incelenir. Çalışan parçalar yeniden yazılmaz; aşağıdaki kabul testlerine göre değerlendirilir. Platform dokümanı ile bu belge arasında teknik bir uyuşmazlık bulunursa gerçek davranış küçük bir testle doğrulanır, karar `docs/DECISIONS.md` içine yazılır. Yetki modeli sessizce değiştirilmez.

Bu çalışma kapsamında yalnızca plan hazırlandı. Önceki araştırmada küçük bir PQ uyumluluk script'i vardı; yeni geliştiriciye ulaşmaması mümkündür. Script veya çıktısı bulunmadan bir aşama tamamlanmış kabul edilmez. Mainnet ürün deployment'ı, audit veya ödül kazanma iddiası yoktur.

## 1. Ürün ve başarı tanımı

ArcMandate, bir yazılım agent'ına kasadaki USDC üzerinde süreli ve toplamı sınırlı harcama yetkisi verir. Agent'ın sıcak anahtarı bu sınırları büyütemez. Oturum açma/değiştirme ve para çekme için owner wallet işlemi ile SLH-DSA imzası birlikte gerekir. Owner veya PQ anahtarı tek başına oturumu iptal edebilir.

İlk kullanıcı, agent çalıştıran birey veya küçük ekip. İlk demo, terminalde çalışan deterministik bir ödeme istemcisidir. LLM veya x402 entegrasyonu yapılmış gibi sunulmaz.

PQ gerekçesi: günlük agent anahtarı sızıntısının etkisini bütçe ve yetki ayrımı sınırlar; PQ, uzun ömürlü yönetim kararlarına ikinci kriptografik onayı ekler. Ayrı klasik yönetim anahtarı da bugünkü tehditlerin önemli bölümünü karşılayabilir. Arc'ın native doğrulayıcısı burada somut bir uygulama yetkilendirmesi için kullanılır. PQ, offline olmanın veya herkesin relay edebilmesinin ön şartı değildir.

Başvuruda üç davranış görünür olmalı:

1. Agent yalnız izinli alıcılara, süre ve bütçe içinde ödeme yapar.
2. Yetkiyi artırmak ve çekim yapmak wallet + PQ onayı gerektirir.
3. İptal edilen oturumun işlemleri, aynı agent'a yeni oturum açılsa bile çalışmaz.

**Sınırlı vaat:** Yalnız agent anahtarı ele geçirilirse, kontrat doğru çalışırken ve yeni insan onayı verilmezken, o oturumdan yapılabilecek ek transferler kalan toplam bütçeyi aşamaz. Freeze öncesinde sıralanan transferler gerçekleşebilir. Agent wallet'ındaki gas bakiyesi bu sınırın dışındadır.

## 2. Sabit kapsam

| Karar | MVP |
|---|---|
| Vault | Kullanıcıya ait tek immutable kontrat; proxy/factory yok |
| Oturum | Aynı anda tek agent; toplam bütçe, işlem tavanı, süre, 1–5 alıcı |
| Varlık | Yalnız Arc USDC'nin ERC-20 arayüzü |
| Yönetim | Owner transaction + PQ; tek anahtar yalnız iptal edebilir |
| PQ kullanımı | Tarayıcı Worker'ı; şifreli dosya export/import ve geri yükleme testi |
| UI | Vite/React ile tek sayfa; yönetim ve wallet gerektirmeyen okuma modu |
| Agent | Ayrı wallet kullanan Node/TypeScript CLI |
| Veri | RPC + kontrat getter/event'leri; backend/veritabanı/indexer yok |
| Kanıt | Gerçek receipt'ler ve simülasyon kayıtlarını ayıran public JSON manifest |

Kapsam dışı: offline signer, QR, key rotation/recovery, günlük yenilenen limit, çoklu agent/token, genel `execute`, approve/DeFi/yield/bridge, ödeme talep kuyruğu, relayer servisi, gas sponsorluğu, ayrı SDK ürünü, mobil wallet matrisi. Yeni büyük özellikler tampon günlerinde de açılmaz.

Anahtar kaybı bedeli açıktır: owner veya PQ anahtarı/parolası kaybolursa çekim yapılamaz. İki anahtar eldeyken yeni vault'a çekim yoluyla migration yapılabilir. Aynı cihazda kullanılan iki anahtar cihaz saldırısına karşı bağımsız güvence sağlamaz.

## 3. Stack, repo ve çalışma komutları

Seçimler: Solidity + Foundry test düzeni; TypeScript + Vite + React + viem; PQ için `@noble/post-quantum`; scrypt için `@noble/hashes`; AES-GCM için Web Crypto; OpenZeppelin SafeERC20 ve storage tabanlı ReentrancyGuard. TS testleri için Vitest. npm workspaces ve tek lockfile yeterli; ek monorepo aracı yok.

Node, solc, Foundry ve bağımlılıkların çalışan kesin sürümlerini başlangıçta sabitle. Noble için önceki deneyin `0.6.1` sürümü yalnız başlangıç referansıdır; güncel sürümün API/uyumluluğunu doğrula, seçilen tam sürümü ve lockfile'ı kaydet. Tarihli bir deney sürümünü otomatik olarak en güvenli sürüm sayma. Solidity compiler ve EVM hedefini Arc'ın güncel uyumluluğuna göre sabitle; araştırmadan “latest” seçme.

Windows kullanılıyorsa mevcut shell/runtime durumunu kontrol et. Arc Foundry kurulumu mümkünse kullan; mümkün değilse standart Foundry ile yerel birim testleri ve gerçek Arc RPC entegrasyonu yürüt. Standart Anvil fork'unun Arc'a özel precompile davranışını kendiliğinden çalıştıracağını varsayma. İki kontrat test altyapısı kurma.

Önerilen yapı (dosyalar iş paketleri geldikçe oluşturulur):

```text
arcmandate/
  contracts/
    foundry.toml
    src/ArcMandateVault.sol
    src/lib/PQVerifier.sol
    test/ArcMandateVault.t.sol
    test/ArcMandateInvariant.t.sol
    test/mocks/
  apps/web/
    src/components/
    src/worker/pq.worker.ts
    src/lib/wallet.ts
    src/lib/transactions.ts
    public/demo-manifest.json
  packages/core/src/
    config.ts
    policy.ts
    digest.ts
    keyfile.ts
    generated/                  # build çıktısından ABI/bytecode
  scripts/
    preflight.ts
    pq-probe.ts
    export-artifacts.ts
    deploy.ts
    agent.ts
    collect-evidence.ts
  fixtures/                     # yalnız kamuya açık test anahtarları/verileri
  deployments/                  # ağ, adres, derleme ve transaction bilgisi
  docs/
    DECISIONS.md
    IMPLEMENTATION-STATUS.md
    THREAT-MODEL.md
    EVIDENCE.md
  .env.example
  .gitignore
  package.json
  package-lock.json
  README.md
```

Root npm script sözleşmesi: `build:contracts`, `test:contracts`, `artifacts`, `test:ts`, `typecheck`, `build:web`, `dev`, `check`, `preflight`, `pq:probe`, `agent`, `evidence`. Bunlar hazırlanacak komut adlarıdır; şu anda mevcut oldukları iddia edilmez. `check`, ağ veya para gerektirmeyen build/test kontrollerini toplar. RPC entegrasyon komutları ayrıca çalışır.

## 4. Arc bağlantısı ve erken doğrulama

29 Eylül 2026 resmî bağlantı bilgileri:

| Alan | Testnet | Mainnet |
|---|---|---|
| Chain ID | 5042002 | 5042 |
| RPC | https://rpc.testnet.arc.io | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.testnet.arc.io | https://explorer.arc.io |
| Faucet | https://faucet.circle.com | Yok; gerçek USDC gerekir |

USDC ERC-20 adresi: `0x3600000000000000000000000000000000000000`. Tutarlar 6 decimal `bigint` olarak işlenir. Native gas arayüzü 18 decimal kullanır; aynı hesabın aynı USDC bakiyesinin iki görünümüdür. UI bu iki değeri toplamaz. Vault ile agent wallet bakiyeleri ise farklı hesaplardır. [Ağ bilgileri](https://docs.arc.io/arc/references/connect-to-arc), [USDC modeli](https://www.arc.io/blog/building-with-usdc-on-arc-one-token-two-interfaces).

`preflight` her ağ için chain ID, son block numarası/zamanı, USDC decimals ve PQ probe sonucunu kaydeder. Chain ID uyuşmuyorsa işlem göndermez. Bir precompile'da `eth_getCode == 0x` bulunması tek başına yokluk kanıtı değildir; geçerli ve geçersiz imzayla gerçek çağrı yapılır.

Arc'ın native transferleri özel kurallara tabidir; yerel mock ERC-20 bu davranışları kanıtlamaz. Fonlama ve vault'tan transfer gerçek ağda denenir. Fee tahmini canlı alınır; RPC timeout'u başarısız receipt sayılmaz. Güncel doküman mainnet ücret tabanını 20 gwei olarak belirtiyor; fee ayarını uygulama başında yeniden kontrol et, düşük fee nedeniyle bekleyen işlemi kontrat hatası sanma. [EVM farkları](https://docs.arc.io/arc/references/evm-differences).

**Testnet fallback:** Resmî PQ sayfası mainnet desteğini açıkça belirtiyor. Testnet desteğini probe ile doğrula. Testnet'te çalışmıyorsa mock testleri ve mainnet salt okunur çağrılarını sürdür; ağ farkını kaydet. Gerçek transaction entegrasyonu için küçük tutarlı mainnet denemesi ancak mevcut harcama yetkisi kapsamında yapılır. PQ kontrolünü devre dışı bırakarak ürün deployment'ı yapma.

## 5. Kontrat arayüzü ve state

Üretim constructor'ı `constructor(address owner_, bytes32 pqPublicKey_)`. Owner ve PQ key sıfır olamaz, owner vault'ın kendisi olamaz. `owner` ve `pqPublicKey` immutable. USDC ve PQ verifier adresleri kaynakta sabit; constructor'dan keyfi verifier veya token kabul edilmez. Yerel testte bu adreslerde mock kullanılır, production kontratına test modu eklenmez.

Owner için ayrı ECDSA mesaj doğrulaması yok: klasik onayı `msg.sender == owner` sağlar. Arayüzde desteklenen ilk owner/agent türü standart EVM wallet'tır. `tx.origin` kullanılmaz; `code.length == 0` üzerinden bir EOA güvenlik iddiası kurulmaz.

```solidity
struct Policy {
    address agent;
    uint256 totalBudget;
    uint256 perTxCap;
    uint256 expiresAt;
    address[] recipients;
}

struct Authorization {
    uint256 nonce;
    uint256 sessionId;
    uint256 deadline;
}

function startSession(Policy calldata policy, Authorization calldata auth, bytes calldata pqSig) external;
function agentPay(uint256 expectedSessionId, bytes32 paymentId, address to, uint256 amount) external;
function freezeByOwner(uint256 expectedSessionId) external;
function freezeByPQ(Authorization calldata auth, bytes calldata pqSig) external;
function withdraw(address to, uint256 amount, Authorization calldata auth, bytes calldata pqSig) external;
```

Bu bir arayüz şartnamesidir; gövdesiz fonksiyonları doğrudan deploy edilebilir kontrat gibi kullanma. Yerel iskelet abstract/interface olabilir; gerçek vault gerekli fonksiyonları uygulamadan fonlanmaz.

State: `controlNonce`, `sessionId`, `active`, mevcut `agent`, `totalBudget`, `spent`, `perTxCap`, `expiresAt`; en fazla 5 mevcut alıcı; `allowed[sessionId][address]` ve `usedPaymentIds[sessionId][paymentId]`.

Getter'lar: owner/key/adresler, current policy + recipients, nonce/sessionId/active, remainingBudget, alıcı ve paymentId sorgusu. Digest view'ları `startSessionDigest(policy, auth)`, `freezeDigest(auth)`, `withdrawDigest(to, amount, auth)` olarak aynı şemayı kullanır. Bir digest hesaplanabilmesi işlemin o anda yetkili/geçerli olduğunu göstermez.

### 5.1 Policy validasyonu

- `agent != 0`, `agent != owner`, `agent != address(this)`.
- `totalBudget > 0`, `0 < perTxCap <= totalBudget`.
- `expiresAt > block.timestamp`; süre saniyedir. UI varsayılanı 15 dakika, kontratta gizli otomatik yenileme yok.
- 1–5 alıcı; sıfır/vault adresi yok; `uint160(address)` olarak kesin artan sırada. Duplicate ve sırasız liste revert olur; UI imzadan önce sıralar.
- Owner ve agent alıcı listesinde teknik olarak bulunabilir. Agent alıcı seçilirse agent'ın parayı kendi hesabına aktarabileceği özet ekranında açık yazılır; allowlist sonradan kullanım garantisi vermez.
- Bütçe bakiyeyi aşabilir: sonradan fonlama kalan yetkiyi kullanılabilir hale getirir. UI bakiye ve verilen yetkiyi ayrı gösterir.

### 5.2 State geçişleri

| İşlem | Ön şart | Başarılı etki |
|---|---|---|
| Deploy | Geçerli owner/key | `sessionId=0`, `controlNonce=0`, `active=false`; policy sıfır |
| startSession | Owner + geçerli PQ/auth + geçerli policy | Eski oturum yerine yeni oturum; her iki sayaç +1; policy kurulur; spent=0; active=true |
| agentPay | Doğru agent/session, active, zaman/alıcı/bütçe/id uygun | spent += amount, id kullanıldı, USDC transfer; yönetim sayaçları değişmez |
| freezeByOwner | Owner, active, expectedSessionId eşit | Eski oturum iptal; her iki sayaç +1; active=false; mevcut policy alanları/alıcı dizisi sıfırlanır |
| freezeByPQ | Active, geçerli auth/PQ; gönderen herhangi wallet | Owner freeze ile aynı etki |
| withdraw | Owner + geçerli auth/PQ; active=false | controlNonce +1; imzalanan alıcı/tutara transfer; sessionId değişmez |
| Süre/bütçe biter | Ödeme anında kontrol edilir | Otomatik state yazılmaz; active true kalabilir; ödeme reddedilir |
| USDC gelir | Token transferi | Yetki ve sayaçlar değişmez |

Sayaç örneği: deploy `(0,0)` → start `(1,1)` → freeze `(2,2)` → withdraw `(2,3)` → start `(3,4)`; çiftin sırası `(sessionId, controlNonce)`.

`startSession`, eski aktif oturumu değiştirdiğinde yalnız birer artış yapar; önce freeze fonksiyonunu çağırıp sonra ikinci kez artırmaz. Eski policy için geçmiş allowlist/paymentId mapping'leri silinmez; yeni sessionId onları erişilemez kılar. Mevcut alıcı dizisinin temizlenmesi en fazla 5 elemandır.

Süre dolan veya bütçesi biten oturumda çekim için önce freeze gerekir. İlk oturumu hiç açılmamış kasadan hybrid çekim yapılabilir. Tekrar freeze, active=false ise revert olur. `freezeByOwner(expectedSessionId)` gecikmiş eski bir owner işleminin yeni oturumu yanlışlıkla iptal etmesini engeller.

### 5.3 Ödeme, çekim ve fonlama

`agentPay` kontrolleri: active → beklenen sessionId → caller → `block.timestamp < expiresAt` → amount pozitif → izinli alıcı → işlem tavanı → kalan bütçe → paymentId kullanılmamış ve sıfır değil → yeterli bakiye. Ödeme id'si ve spent dış çağrıdan önce yazılır. Transfer SafeERC20 ile yapılır; hata tüm state değişimini geri alır.

`withdraw` tutarı pozitif, alıcısı sıfır/vault değil ve bakiye yeterli olmalı. Nonce dış transferden önce tüketilir; transfer başarısızsa nonce da geri döner. Agent bu fonksiyonu çağırarak yetki kazanamaz.

Tüm state değiştiren girişlerde aynı storage ReentrancyGuard kullanılır. Arbitrary call, delegatecall, selfdestruct, token approve, payable execute ve yükseltilebilirlik yok. Gas işlem gönderen wallet'tan ödenir; vault geri ödeme yapmaz.

Fonlama ayrı `deposit` gerektirmez: UI USDC üzerinde `transfer(vault, amount)` çağırır, receipt ve `balanceOf` okur. Vault'ta payable receive/fallback eklemek gerekmez. Arc'ın native/USDC sistem davranışı yüzünden vault'a hiçbir başka yoldan bakiye gelemez varsayımı kurulmaz. Uygulama 6 decimal transferleri destekler; dışarıdan oluşabilecek daha küçük native bakiyeler için ayrı sweep özelliği eklenmez ve tam native sıfırlama sözü verilmez.

### 5.4 Event ve hatalar

- `SessionStarted`: yeni sessionId, agent, bütçe, cap, expiry, recipients, yeni controlNonce.
- `AgentPaid`: sessionId, paymentId, alıcı, amount, yeni spent.
- `SessionRevoked`: eski sessionId, yeni sessionId, sebep (OWNER/PQ/REPLACED), gönderen, yeni controlNonce. Replace sırasında revoked ve started aynı yeni sürümü anlatır.
- `Withdrawn`: alıcı, amount, yeni controlNonce.

Custom error'lar en az şu ayrımları sağlamalı: Unauthorized, SessionInactive, SessionMismatch, SessionExpired, InvalidPolicy, InvalidAmount, RecipientNotAllowed, PerPaymentLimitExceeded, BudgetExceeded, PaymentAlreadyUsed, InvalidNonce, AuthorizationExpired, InvalidPQSignature, InsufficientBalance. Testler yalnız “revert oldu” değil ilgili sebebi de kontrol eder. Fonlama vault event'i üretmez; USDC receipt'i kullanılır.

## 6. İmzalanan mesajın kesin şeması

Bu şema ArcMandate tasarım kararıdır. Üç uygulama aynı sırayı ve türleri kullanır: Solidity, TS core ve tarayıcı Worker. Sayaç/tutar/zaman türleri `uint256`; TS'de `bigint`. JSON'da bu sayılar decimal string olarak saklanır.

```text
DOMAIN  = keccak256(UTF8("ArcMandate"))
VERSION = keccak256(UTF8("1"))
START   = keccak256(UTF8("START_SESSION"))
FREEZE  = keccak256(UTF8("FREEZE"))
WITHDRAW= keccak256(UTF8("WITHDRAW"))

recipientsHash = keccak256(abi.encode(address[] recipients))
startParams   = keccak256(abi.encode(
  address agent, uint256 totalBudget, uint256 perTxCap,
  uint256 expiresAt, bytes32 recipientsHash
))
freezeParams  = bytes32(0)
withdrawParams= keccak256(abi.encode(address to, uint256 amount))

digest = keccak256(abi.encode(
  bytes32 DOMAIN, bytes32 VERSION,
  uint256 chainId, address vault, address owner,
  bytes32 action, uint256 nonce, uint256 sessionId,
  uint256 deadline, bytes32 paramsHash
))
```

Bu gösterim Solidity'nin birebir kopyalanacak ifade sözdizimi değildir; alan türlerini açıklar. `abi.encode(recipients)` tek dinamik array argümanının tam ABI kodlamasıdır. `abi.encodePacked`, JSON hash'i, kişisel imza prefix'i veya ek EIP-712 prefix'i eklenmez.

Kontrat chainId/vault/owner'ı kendi bağlamından alır. `auth.nonce == controlNonce`, `auth.sessionId == sessionId` ve `block.timestamp < auth.deadline` şarttır; deadline'ın tam anında ret vardır. UI deadline'ı son zincir zamanından 10 dakika sonrası olarak hazırlar, gönderimden önce yeniden kontrol eder. Yeni session expiry'si imza hazırlığında gelecekte olsa bile execution anında tekrar doğrulanır.

SLH-DSA bu digest'in **32 ham byte'ını**, pure mode ve boş context ile imzalar. “Keccak ile digest almak”, Noble'ın ayrı HashSLH-DSA/prehash modunu seçmek anlamına gelmez. Kullanıcıya gösterilen özetten yapılandırılmış intent üretilir; Worker aynı intent'ten digest hesaplar. Opaque hash imzalayan genel endpoint yapılmaz.

Başarılı start/freeze/withdraw nonce tüketir; agentPay tüketmez. Freeze öncesi hazırlanmış start/withdraw imzaları iptal olur. Yeni start eski PQ freeze imzasını da geçersiz kılar; kullanıcı güncel iptal imzası üretir. İptalden önce zincire girmiş işlem geri alınamaz.

**Test vektörü şartı:** Her action için sabit input, recipientsHash, paramsHash ve beklenen digest JSON fixture'ı oluştur. TS çıktısını Solidity view ile birebir karşılaştır; yalnız aynı TS fonksiyonunu iki kez çağıran test yeterli değildir. Birer alanı değiştirince imza reddedilmeli. Sabit test anahtarları yalnız test içindir; deployment key'i olamaz.

## 7. PQ verifier entegrasyonu

Adres: `0x1800000000000000000000000000000000000004`.

```solidity
function verifySlhDsaSha2128s(bytes vk, bytes message, bytes sig) external returns (bool);
```

Public key 32 byte, imza 7856 byte. Native wallet transaction'ı PQ imzalı değildir; PQ onayı kontratın uygulama katmanındadır. [Resmî PQ açıklaması](https://docs.arc.io/arc/concepts/post-quantum-security), [precompile kaynağı](https://github.com/circlefin/arc-node/blob/main/crates/pq-precompile/src/lib.rs).

`PQVerifier` sabit adrese ABI selector + üç `bytes` argümanı ile düşük seviyeli `staticcall` yapar. `bytes32` key ve digest'in her biri tam 32 byte'a dönüştürülür; metin olarak gönderilmez. Sabit adres için code.length şartı koyma. Call başarısız, return uzunluğu 32'den farklı veya dönen ABI word'ü tam 1 değilse işlem reddedilir. Boş return hiçbir durumda başarılı doğrulama değildir. Public imza uzunluğu doğrulama çağrısından önce kontrol edilir.

İlk probe sırası: yerel sign/verify → RPC `eth_call` geçerli/geçersiz → tarayıcı Worker çıktısı → testnet'te aynı wrapper üzerinden gerçek transaction. İlk üç adım P1'i kapatır; son adım P2'deki ilk `startSession` ile tamamlanabilir. Ek probe kontratı yalnız teşhis gerekirse deploy edilir. Farklı mesaj ve bozuk boyut testlerinde false/revert ayrımı kaydedilir, ikisi de yetki vermemeli.

İmza süresi ölçülür; tahmini sabit süre veya sahte ilerleme yüzdesi kullanılmaz. Gas gerçek çağrıdan tahmin edilir. [Noble API ve güvenlik sınırları](https://github.com/paulmillr/noble-post-quantum): kütüphane bağımsız audit ve constant-time garanti iddiasında bulunmuyor; proje de böyle sunulmaz.

## 8. Anahtar dosyası ve tarayıcı signer'ı

### 8.1 Basit dosya sözleşmesi

Anahtar Worker içinde CSPRNG ile bağımsız üretilir. Secret'ın wallet'ın public imzasından türetilmesi yasaktır. SLH-DSA-128s secret 64 byte; public key 32 byte. Secret düz metin dosya, localStorage, URL, console veya analytics'e çıkmaz.

Dosya alanları: `format="arcmandate-keyfile"`, `version=1`, `algorithm="SLH-DSA-SHA2-128s"`, publicKey, KDF tanımı, cipher tanımı ve ciphertext. Hex alanları `0x` önekiyle küçük harfli; bilinmeyen version/algorithm reddedilir.

Uygulanacak başlangıç profili: scrypt `N=131072, r=8, p=1, dkLen=32`; 32 byte rastgele salt; AES-256-GCM, 12 byte rastgele IV, 128 bit tag. Web Crypto ciphertext çıktısı tag'i içerir. Her export yeni salt ve IV üretir. V1 import yalnız bu profili kabul eder; dosyanın istediği keyfi KDF parametreleri çalıştırılmaz. Import öncesi dosya boyutu üst sınırı 16 KiB ve alan/uzunluk denetimi yapılır.

Bu profil yaklaşık 128 MiB scrypt belleği gerektirir; ilk hedef masaüstü tarayıcıda ölçülür. Kullanılamıyorsa geliştirme sırasında yeni profil açık kararla belirlenip test edilir; import sırasında otomatik zayıflatılmaz. Parola aynen UTF-8 kodlanır, sessizce trim/normalize edilmez; UI güçlü bir parola ve tekrar girişini ister.

AAD için sabit alan sıralı JSON array kullanılır:

```text
[format, version, algorithm, publicKey,
 "scrypt", N, r, p, dkLen, salt,
 "AES-256-GCM", iv]
```

Tüm alanlar şema/uzunluk doğrulamasından sonra bu sırayla `JSON.stringify` + UTF-8 ile kodlanır. Ciphertext AAD'ye eklenmez. Dosyanın metadata'sını değiştirmek GCM kontrolünü bozmalıdır. Kendi scrypt/AES algoritması yazılmaz.

### 8.2 Geri yükleme ve Worker sınırı

1. Key üret → public key'i göster → şifreli dosyayı indir.
2. Worker'ı kilitle/sonlandır; dosyayı ve parolayı yeniden iste.
3. Dosyayı çöz → public key eşleşmesini kontrol et → geri yüklenen secret ile rastgele deneme mesajını imzala ve doğrula.
4. Yalnız bundan sonra uygulamadaki deploy/fonlama akışını aç. Var olan vault import'unda dosya key'i onchain public key ile eşleşmeli.

Bu UI kontrolü, dışarıdan vault'a transfer yapılmasını engellemez. Anahtar/parola kaybı halinde ECDSA-only kurtarma yoktur.

Worker işleri: generate/export/import, structured intent sign, local verify, lock. Ana iş parçacığına public key, encrypted dosya ve imza dönebilir; secret dönmez. Sign isteği işlem türü ve tam alanlarla gönderilir. UI her yönetim işleminde okunabilir onay ister; agent ödemeleri PQ dosyasının açık kalmasını gerektirmez.

`lock`, disconnect veya vault/network değişiminde Worker sonlandırılır, bekleyen imza intent'leri atılır. Sekme kapanması veya JS bellek temizliği için kesin sıfırlama garantisi verilmez. Worker UI donmasını azaltır; kötü amaçlı frontend'e karşı ayrı güvenlik cihazı değildir. Ürün offline signer olarak tanıtılmaz.

## 9. Frontend ve agent davranışı

### 9.1 Tek sayfa

- Wallet bağlamadan demo kontratı, güncel bakiye/yetki ve kanıtlar okunur.
- Kurulum bölümünde owner wallet, PQ üret/import, geri yükleme kontrolü ve deploy bulunur. Gecikmede deploy CLI'ya taşınabilir; mevcut vault adresiyle açma kalır.
- Fonlama ERC-20 transferidir. Tüm wallet bakiyesini gönderip gas'sız bırakacak otomatik “max” davranışı yok.
- Oturum formu agent, totalBudget, perTxCap, recipients, expiresAt içerir. Değiştirmede eski/yeni politika beraber gösterilir.
- Owner freeze, PQ freeze, hybrid withdrawal ve yeni session eylemleri görünür. PQ freeze'de bağlı wallet owner olmasa da gönderim yapılabilir; server relayer yoktur.
- “Süre doldu” ile onchain `active=false` ayrılır. Çekim için gerekirse önce ayrı freeze işlemi önerilir; receipt beklenmeden withdrawal imzası hazırlanmaz.
- Anahtar dosyası, owner ve ağ uyuşmazlığı açık hata verir. Salt okunur demo modunda işlem gönderilmez.

### 9.2 İşlem yaşam döngüsü

Intent hazırlığı → insan onayı → Worker imzası → güncel chain/account/session/nonce kontrolü → simulation → wallet gönderimi → receipt → aynı block'a tutarlı state yenileme. İmza sırasında form değişirse intent iptal edilir. Ağ/account değişince eski imza kullanılamaz. Kullanıcı wallet'ta reddederse state başarılı gösterilmez.

İşlem durumları: hazırlanıyor, imzalanıyor, wallet onayı bekliyor, gönderildi, onaylandı, simülasyonda reddedildi, zincirde revert, RPC sonucu belirsiz. Revert transaction'ı yoksa explorer hash'i uydurulmaz. İmza nonce'u değiştiyse otomatik yeni yetki imzalanmaz; kullanıcı güncel özeti yeniden onaylar.

Event sorguları vault adresi ve deployment block'undan itibaren sınırlı aralıklarla yapılır. Listenin kimliği `(chainId, txHash, logIndex)`; aynı işlemin iki USDC görünümünü çift sayma. Ana ödeme kanıtı vault'ın `AgentPaid` event'idir. RPC erişilemiyorsa eski cache canlı veri gibi gösterilmez.

### 9.3 Agent CLI ve retry

Agent CLI yalnız agent wallet anahtarını kullanır; owner/PQ secret'ına erişmez. Secret, Vite public env değişkenine veya repo'ya konmaz. Testnet script otomasyonu için ayrılan test owner/PQ anahtarları gerçek kullanıcı anahtarlarından ayrı tutulur.

Ödeme isteği yerel bir journal'a gönderimden **önce** yazılır: chainId, vault, sessionId, paymentId, to, amount. `paymentId` 32 byte rastgele sıfır olmayan kimliktir. Gönderim sonrası txHash eklenir; logda private key yoktur.

Timeout'ta önce receipt ve `usedPaymentIds(sessionId,id)` sorgulanır. Kullanılmışsa tekrar ödeme gönderilmez, event/receipt bulunur. Pending ise beklenir; gerçekten yeniden gönderilecekse aynı sessionId/paymentId/to/amount kullanılır. Gas replacement gerekiyorsa wallet nonce yönetimi tutarlı tutulur. Yeni session'a sessizce taşınmaz. Terminal yeniden başlasa da journal'daki kimlik korunur.

Bir paymentId kontratta tekrar kullanılamadığı için farklı parametreyle yeniden çağrı da reddedilir. Servisin teslim edildiği, USDC transferinin başarılı olmasından çıkarılamaz; teslim/refund protokolü MVP kapsamında değildir.

## 10. Test matrisi ve kabul kriterleri

Test ID'lerini `docs/IMPLEMENTATION-STATUS.md` içinde dosya/test adına bağla. Sonuçlar actual command, commit ve çıktı özetiyle kaydedilir.

| ID | Kanıtlanacak davranış | Katman |
|---|---|---|
| T01 | Constructor ve policy: zero/self adresler, agent=owner, bütçe/cap, sırasız/duplicate/0/6 alıcı | Solidity unit |
| T02 | start/withdraw owner + PQ ister; agent/PQ-only/owner-only ret | Unit + gerçek ağ pozitif akış |
| T03 | Per-call tavan ve farklı paymentId'lerle parçalanmış toplam bütçe; tam sınır kabul | Unit + fuzz |
| T04 | Gün değişimi ve ek fonlama yetkiyi artırmaz; doğrudan transfer bakiyeye yansır | Unit + Arc transfer testi |
| T05 | Expiry/deadline hemen öncesi kabul, tam anında ret; geçmiş expiry policy ret | Unit |
| T06 | Caller, allowlist ve active kontrolü | Unit |
| T07 | Aynı paymentId retry/restart çift ödeme yapmaz; yeni session eski isteği otomatik taşımaz | Unit + TS journal |
| T08 | İki freeze yolu; sessionId ve controlNonce ilerler; tekrar freeze ret | Unit + ağ |
| T09 | Freeze sonrası eski admin imzaları ve eski agent çağrısı ret; aynı agent'a yeni session'da da eski çağrı ret | Unit + ağ demo |
| T10 | Yanlış key/message/action/chain/vault/owner/nonce/session/deadline ve policy'nin her alanı ret | Digest fixture + imza entegrasyonu |
| T11 | Precompile false, revert, boş/bozuk return ve bozuk sig boyutu fail-closed | Mock verifier unit + gerçek probe |
| T12 | Transfer başarısızlığı spent/id/nonce'u geri alır; reentrancy ek yetki/transfer oluşturmaz | Mock token unit |
| T13 | Hiç session açmadan withdrawal; active/expired-active withdrawal ret; freeze sonrası çekim | Unit + ağ |
| T14 | Şifreli export/import; yanlış parola, bozuk AAD/tag, büyük dosya, yanlış KDF/key, Worker lock | TS + tarayıcı |
| T15 | JS ve Solidity digest aynı; format negatifleri; Worker imzası Arc'ta doğrulanır | TS + Solidity + ağ |
| T16 | Wrong network/account değişimi, pending/rejected/reverted ayrımı; temiz tarayıcı restore → yönetim | Tarayıcı smoke |

Invariant handler yalnız beklenen geçerli girişler üretmekle sınırlanmaz; ödeme/doğrudan fonlama/freeze/start/zaman ilerletme kombinasyonlarını dener. En az: session bazında spent toplam bütçeyi aşamaz; ödeme toplamı o session'a verilen yetkiyle uyumlu; iptal edilmiş session yeniden etkinleşmez; başarısız transfer id/nonce tüketmez. Tümü revert olan fuzz koşusu başarı kanıtı değildir; başarılı çağrı sayısı ve önemli yolların çalıştığı kontrol edilir.

Arc-specific davranış için en az gerçek PQ wrapper çağrısı ve gerçek USDC vault transferi gerekir. Yerel mock testlerinden güvenlik/uyumluluk sonucu genellenmez. Testnet uyumsuzluğu varsa fallback sonucu açık yazılır.

## 11. İş paketleri ve bağımlılıkları

| Paket | İş / üretilecek çıktı | Bağımlılık | Bitiş şartı |
|---|---|---|---|
| P0 | Repo/toolchain/config, preflight, sürüm kararları, secret ignore | Yok | Build ve read-only ağ kontrolleri çalışır |
| P1 | Digest fixture'ları, PQ wrapper/probe, Worker mini denemesi | P0 | TS/Solidity digest eşit; gerçek verifier + negatif örnek; Worker ölçümü |
| P2 | Tüm vault akışı: start/pay/iki freeze/withdraw + birim testleri | P1 | Script'ten fonla → yetki → ödeme → iptal → çekim; T01–T13 temel kapsam |
| P3 | Şifreli keyfile + restore + Worker yaşam döngüsü | P1 | T14–T15; temiz oturumda aynı key ile imza |
| P4 | Tek sayfa UI, deploy/fund, yönetim ve readonly mod | P2, P3 | T16; temel akış wallet üzerinden yapılır |
| P5 | Agent journal/retry, demo manifesti, tam prova | P2, P4 | Tekrarlanabilir testnet/Arc demo; kanıtlar gerçek |
| P6 | Fuzz/inceleme, temiz clone build, mainnet release hazırlığı | P5 | Açık kritik hata yok; release artifact ve maliyet taslağı hazır |
| P7 | Mainnet deployment, kanıtlar, public demo ve başvuru paketi | P6 + gerekli hesap/fon yetkileri | Bölüm 13 kabul listesi geçer |

P3, P2 ile aynı dönemde yapılabilir; bunun için ayrı agent veya ek araç şart değildir. İlk iki günde görsel tasarım beklemez; basit test harness yeterlidir. README ve tehdit modeli karar alındıkça yazılır, son güne bırakılmaz.

Her paket sonunda status dosyasına: tamamlanan işler, test sonuçları, kalan hata, sonraki görev, kullanılan sürümler ve ağ kanıtı yazılır. Bir sonraki geliştirici işi tekrar keşfetmek zorunda kalmamalı.

## 12. Demo ve kanıt formatı

Demo öncesi: owner, agent ve PQ freeze işlemini gönderecek üçüncü wallet hazırlanır. Owner/PQ key yedekten geri yüklenebilir. Kasaya 1 USDC; diğer wallet'lara ayrı ve küçük gas bakiyesi. Mainnet toplam harcama bütçesi deployment öncesi tahmin edilir; 1 USDC yalnız kasadaki demo bakiyesidir.

1. Session S: total=0,15 USDC, perTx=0,05, expiry=15 dakika; izinli bir demo alıcısı.
2. Agent 0,05 öder → kalan yetki 0,10; kasa 0,95.
3. 0,20 denemesi limit nedeniyle reddedilir. Bu örnek per-call limitini gösterir; toplam limit kanıtı T03'tedir.
4. Üçüncü wallet güncel PQ imzasıyla freeze gönderir.
5. Önceden geçerli 0,05 ödeme, eski S ile reddedilir.
6. Aynı agent adresine yeni session açılır; eski S çağrısı yine reddedilir, yeni session ödemesi geçer.
7. Yeni session durdurulur; kalan 6 decimal USDC bakiyesi owner + PQ ile çekilir.

Adım 5/6'da yeni transaction nonce'u ve kullanılmamış paymentId kullan; ret sebebi kontrattaki session kontrolü olmalı. Yeni session alıcı/tutar/süre bakımından ödemeye izin vermeli. Eski bir transaction hash'inin ağ tarafından tekrar reddedilmesi bu kanıt değildir.

Manifest üst alanları: schemaVersion, chainId, vault, deploymentBlock, deploymentTxHash, sourceCommit, compiler/settings, createdAt, steps. Her step: label, expectedOutcome, evidenceType, varsa txHash/blockNumber/blockHash/receiptStatus/gasUsed/effectiveGasPrice, simulation ise from/to/calldata/block ve decoded error. Simülasyonun yapıldığı block'tan sonra state değişebileceği belirtilir; tekrar kontrol receipt kanıtıyla karıştırılmaz.

`evidenceType`: `mined_success`, `mined_revert`, `simulation_rejection`. Mainnet'te sırf ret kanıtı için gereksiz ücretli işlem gönderilmez; simülasyon kabul edilebilir ama etiketi doğru olmalı. Başarılı transfer, hybrid start/çekim ve PQ freeze gerçek mined receipt gerektirir. Mined revert receipt her zaman revert reason taşımaz; reason yalnız gerçekten decode edildiyse gösterilir.

Video 60–90 saniye: normal ödeme → sınır → PQ freeze → eski session'ın yeni oturumda da reddi. Kurulum ve çekim linkleri aynı sayfada bulunur; gerekli kesmeler belirtilir. Salt okunur sayfa demo bittikten sonra bakiyenin çekildiğini dürüstçe gösterir; önceki state canlıymış gibi canlandırılmaz.

## 13. Release, migration ve teslim

Mainnet öncesi clean checkout/build, unit/fuzz/TS/smoke testleri, gerçek Arc entegrasyonu, key restore ve withdrawal başarılı olmalı. Build settings, constructor args, bytecode/artifact hash, commit ve lockfile kaydedilir. Explorer source verification gerçek başarıyla kontrol edilir; komutun çalıştırılması başarı sayılmaz. [Arc dağıtım rehberi](https://docs.arc.io/arc/tutorials/deploy-on-arc).

Kontrat immutable'dır. Mainnet kontrat hatası “aynı adrese patch” ile çözülmez. Mümkünse mevcut session iptal edilir, hybrid çekimle fonlar çıkarılır, düzeltilmiş kontrat test edilip yeni adrese deploy edilir; demo manifesti ve UI adresi güncellenir. Çekim yolu da bozuksa kurtarma varsayılmaz; problem ve risk açık raporlanır. Eski adres deprecated olarak korunur.

Hesap, hosting veya fon yetkisi eksikse AI yerel build, testler, deployment artifact'leri, tahmini maliyet ve tam yapılacak işlemi hazırlayıp somut eksik bilgiyi ister. Özel anahtar/parola sohbet mesajında istenmez. Test/demo script'leri varsayılan olarak testnet kullanır; mainnet yayın ve harcamaları kullanıcının verdiği hesap/harcama yetkisi kapsamında yapılır. Her iş paketini ayrı onay bekleyerek durdurmak gerekmez.

Teslim kontrolü:

- [ ] Public repo temiz clone'dan kurulup derleniyor; `.env`, keyfile ve private journal repo/build içine sızmıyor.
- [ ] Mainnet deployment ve kaynak/derleme bilgisi mevcut; explorer doğrulama sonucu kayıtlı.
- [ ] Canlı HTTPS web, Worker ve RPC erişimi gerçek tarayıcıda çalışıyor; secret içeren env web bundle'a girmiyor.
- [ ] Wallet olmadan demo açılıyor; kanıt linkleri doğru ağ/adres/receipt'e gidiyor.
- [ ] Başarılı hybrid start, agentPay, PQ freeze, yeni session, eski session reddi ve hybrid çekim kanıtları var.
- [ ] Kritik testler ve key restore geçiyor; açık hatalar/limitler README ve threat model'de.
- [ ] Kısa video, açıklama, public builder profili, canlı deployment ve repo bağlantısı hazır.
- [ ] Başvuru metni yalnız gerçekten uygulanmış özellikleri anlatıyor; offline/x402/audit/ilk-ever iddiası yok.

Program mainnet'te çalışan küçük prototipleri kabul ediyor; public repo ve builder profili istiyor. Hedef 8 Ekim, gecikmede 11 Ekim; son tarih 14 Ekim 2026, 23:59 ET. 12–14 Ekim tamponu özellik eklemek için kullanılmaz. Daha önce Circle/Arc fonlaması alma gibi uygunluk şartları gönderimde tekrar kontrol edilir. [Resmî program](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq).

## 14. İlk roadmap'e göre düzeltilenler

| Sorun | Uygulama kararı |
|---|---|
| `deposit` yeniden kapsamda | Doğrudan ERC-20 transfer; özel deposit/approval akışı yok |
| Foundry/Hardhat, Next/Vite belirsiz | Foundry düzeni + Vite/React + viem sabit |
| Fonksiyon başlıklarıyla deploy bekleniyor | Derlenen yerel iskelet; boş vault'a fon yok; gereksiz probe deployment'ı yok |
| Withdraw ilk kontrol noktasından sonra | İlk tam akışta çekim de kanıtlanır |
| Key backup/restore ve Worker süresi eksik | P3 ayrı iş paketi; erken Worker ölçümü |
| Frontend tek güne sıkışmış | 3–5 Ekim UI/keyfile/entegrasyon penceresi |
| Freeze yalnız nonce artırıyor | SessionId de ilerler; owner freeze bile beklenen session'ı bağlar |
| Yeni session sonrası eski işlemler eksik | Aynı agent adresiyle açık negatif test ve demo |
| Her adım için hash bekleniyor | Simulation/receipt ayrımı ve kanıt şeması |
| Mainnet kontrat düzeltmesi belirsiz | İptal/çekim mümkünse migration + yeni deployment |
| Testnet PQ varsayılıyor | Başlangıç probe'u ve açık fallback |
| “Tampon boşta kalır” varsayımı | Hata, öğrenme ve yayın gecikmesi aynı tamponu kullanır |

## 15. Kaynaklar ve doğrulama sınırı

Kaynak kontrol tarihi: 29 Eylül 2026. Ağ/kriptografi bilgileri resmî kaynaklardan; session modeli, digest ve dosya şeması bu projenin önerilen tasarımıdır. Bu turn'de ağ transaction'ı gönderilmedi ve uygulama testleri çalıştırılmadı.

- [Arc bağlantı bilgileri](https://docs.arc.io/arc/references/connect-to-arc)
- [Arc PQ desteği](https://docs.arc.io/arc/concepts/post-quantum-security)
- [Arc precompile adresleri](https://docs.arc.io/arc/concepts/execution-layer)
- [Circle PQ verifier kaynak kodu](https://github.com/circlefin/arc-node/blob/main/crates/pq-precompile/src/lib.rs)
- [Arc USDC modeli](https://www.arc.io/blog/building-with-usdc-on-arc-one-token-two-interfaces)
- [Arc EVM farkları](https://docs.arc.io/arc/references/evm-differences)
- [Arc deployment ve verification](https://docs.arc.io/arc/tutorials/deploy-on-arc)
- [Noble post-quantum](https://github.com/paulmillr/noble-post-quantum)
- [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq)

Arc Guard, Barkeep ve ARCANUM benzer parçalar sunan araştırma referanslarıdır; bu plan benzersizlik iddiası kurmaz. Kod alınırsa ilgili repo lisansı korunur. Ödül olasılığına yüzdelik verilmez; hedef açık ve tekrar üretilebilir teknik kanıttır.
