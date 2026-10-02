# ArcMandate — Uygulama Roadmap'i

Sürüm: 2.0 · 29 Eylül 2026  
Hedef başvuru: 8 Ekim · Gecikmede iç hedef: 11 Ekim  
Resmî son tarih: 14 Ekim 2026, 23:59 ET  
Teknik kaynak: [ArcMandate-implementation-plan.md](ArcMandate-implementation-plan.md).

Bu roadmap, verilen ilk dosyanın düzeltilmiş sürümüdür. Görevlerin tamamı başlangıçta açık kabul edilir. Tarihler yoğun günlük çalışma varsayımıdır; kabul koşulu geçmeden sonraki riskli aşamaya geçilmez. Başlangıç tarihi kayarsa gerekli kontroller atlanmaz, takvim yeniden hesaplanır.

## 1. Sabit hedef

Tek vault, tek agent oturumu, USDC için toplam bütçe + işlem limiti + alıcı listesi + süre. Yeni yetki ve çekimde wallet + PQ onayı. Owner veya PQ ile durdurma; eski oturum işlemleri yeni oturumda da geçersiz. Sade web, şifreli key export/import, Node agent ve gerçek mainnet kanıtları.

Offline signer, factory, backend, relayer servisi, LLM, x402, günlük limit, talep kuyruğu ve recovery ilk teslimde yok. Özel `deposit` yok; kasaya USDC `transfer` ile gönderilir.

## 2. Takvim ve somut çıktılar

### 29 Eylül — P0: Ortam, repo, ağ kontrolü

- [x] Mevcut repo/kod ve yerel kuralları incele; çalışan parçaları tespit et.
- [x] Solidity/Foundry, TS/Vite/React/viem düzenini kur; sürümleri sabitle.
- [x] Secret dosyalarını ignore et; public `.env.example` ve root komutları hazırla.
- [x] Testnet/mainnet chain ID, RPC, USDC decimals ve gerçek PQ probe için config oluştur.
- [x] Testnet faucet erişimini kontrol et; mainnet fon ihtiyacını erken kaydet.

Çıkış: Yerel build çalışıyor; bağlantı sonuçları `docs/IMPLEMENTATION-STATUS.md` içinde. Boş/eksik vault'a fon gönderilmez.

### 30 Eylül — P1: Digest ve gerçek PQ uyumu

- [x] Implementation plan'daki kesin ABI/digest şemasını Solidity ve TS'de uygula.
- [x] START/FREEZE/WITHDRAW için ortak test fixture'ları üret.
- [x] Geçerli imzayı ve bozuk mesaj/imzayı gerçek RPC ile dene.
- [x] Tarayıcı Worker'ında anahtar üretme ve imzalama süresini ölç; çıktıyı Arc verifier'a gönder.
- [x] Testnet desteğini gerçekten doğrula. Çalışmıyorsa testnet fallback kararını kaydet.

Çıkış: TS/Solidity digest eşit, gerçek verifier pozitif ve negatif örnekleri ayırıyor, Worker UI'ı kilitlemiyor. Gerçek vault transaction doğrulaması P2'de tamamlanır.

### 1–2 Ekim — P2: Tam kontrat akışı ve ilk kritik kontrol

- [x] startSession, agentPay, freezeByOwner, freezeByPQ ve withdraw uygula.
- [x] sessionId/controlNonce, paymentId, recipient sıralaması ve event'leri tamamla.
- [x] Unit testleri fonksiyonlarla birlikte yaz; aktarım hatalarının rollback'ini dene.
- [x] Arc üzerinde fonla → oturum aç → ödeme → ret → PQ freeze → çekim akışını çalıştır.
- [x] Aynı agent'a yeni oturum açıldığında eski sessionId çağrısının reddini göster.

**2 Ekim kontrolü:** Gerçek PQ kullanan bir vault işlemi, gerçek USDC ödemesi, freeze ve hybrid çekim çalışmalı. Eski oturum reddi ve iki anahtar zorunluluğu test edilmiş olmalı.

Geçmezse sorun sınıfını kaydet: toolchain, PQ/ABI, ağ, kontrat veya anahtar. Görsel işler/deploy UI'ı ertelenir; PQ, çekim, bütçe ve replay koruması kesilmez. “Küçük hata” diyerek mainnet'e geçilmez.

### 3–4 Ekim — P3/P4: Anahtar dosyası ve temel web

- [x] Şifreli export/import, yanlış parola/bozuk dosya kontrolleri ve Worker lock ekle.
- [x] Worker kapatılıp dosya yeniden açılarak restore + deneme imzası testini geçir. P4'te tarayıcı export'u değişmeden diske kaydedilip temiz sayfada aynı dosya geri yüklendi; OS dosya seçicisi/gerçek wallet eklentisi kontrolü P6'da. Bkz. `docs/IMPLEMENTATION-STATUS.md`.
- [x] Tek sayfada wallet/ağ, vault açma/deploy ve ERC-20 fonlama ekle.
- [x] Session formu, yetki özeti, iki freeze yolu ve hybrid çekim ekle.
- [x] Bekleyen, wallet'ta reddedilen, simülasyonda reddedilen ve mined işlemleri ayır.

Çıkış: Temiz tarayıcı oturumunda şifreli dosya geri yükleniyor ve temel yönetim işlemleri çalışıyor. Arayüz İngilizce tek dil; anlamlı hata metni ve receipt bağlantıları var.

### 5 Ekim — P5: Agent, kanıtlar ve tam prova

- [x] Agent CLI için gönderim öncesi paymentId journal'ı ve receipt/state kontrollü retry yap.
- [x] Script yeniden başlasa da aynı ödeme ikinci kez gitmiyor testini geçir.
- [x] Demo manifestini gerçek transaction/simulation sonuçlarından üret.
- [x] Wallet gerektirmeyen okuma modunu aynı sayfaya ekle (P4'te tamamlandı).
- [x] Tüm demo ve çekimi testnet'te tekrar et; fallback kullanıldıysa açık kaydet.

Çıkış: Tekrarlanabilir demo; eski session denemesinde ret sebebi kontrat kontrolü. Anahtarlar ve private journal public kanıt dosyasına girmiyor.

### 6 Ekim — P6: İnceleme ve release hazırlığı

- [ ] Implementation plan T01–T16 test matrisi ve fuzz sonuçlarını tamamla.
- [ ] Temiz clone/build ve tek tarayıcı uçtan uca smoke testi yap.
- [ ] İmza formatı, tüm para çıkışları, replay ve key restore akışını tekrar incele.
- [ ] README, THREAT-MODEL, derleme ayarları ve bilinen sınırlamaları yaz.
- [ ] Deployment artifact, constructor argümanları ve canlı gas tahminini hazırla.
- [ ] Mainnet funding, yayın hesabı veya yetki eksikse somut ihtiyacı bu aşamada çöz.

Çıkış: Açık kritik hata yok; release paketi hazır. Yapılan kod incelemesi bağımsız audit olarak sunulmaz.

### 7 Ekim — P7: Mainnet ve gerçek kanıtlar

- [ ] Verilmiş harcama yetkisi kapsamında küçük demo fonlarıyla deploy et.
- [ ] Explorer source verification sonucunu kontrol et.
- [ ] Normal ödeme, limit reddi, PQ freeze, eski session reddi, yeni session ve hybrid çekimi tamamla.
- [ ] Gerçek gas/receipt bilgilerini kaydet; simülasyon retlerini doğru etiketle.
- [ ] Canlı web'in doğru kontrata bağlandığını, Worker/RPC ve okuma modunu kontrol et.

Çıkış: Mainnet kanıtları açılıyor; demo fonlarının çekimi tamamlanmış. Demo sonucunu gösteren web yayını hazır.

### 8 Ekim — Başvuru hedefi

- [ ] 60–90 saniyelik video oluştur.
- [ ] Public repo, canlı web, builder profili ve kısa açıklamayı kontrol et.
- [ ] README'deki bütün özellik iddialarını gerçek build ile eşleştir.
- [ ] Başvuru kanalının güncel bağlantısı ve uygunluk koşullarını kontrol ederek başvuruyu gönder.

Çıkış: Başvuru gerçekten gönderilmiş ve sonucu/kaydı tutulmuş. Form taslağının hazırlanması “gönderildi” diye raporlanmaz.

### 9–11 Ekim — Gecikme payı

Eksik kabul koşulları ve yayın sorunları tamamlanır. İç son başvuru hedefi 11 Ekim. Hazır proje bu tarihe kadar sebepsiz bekletilmez; erken hazırsa gönderilir. Yeni özellik eklenmez.

### 12–14 Ekim — Son tampon

Başvuru/link/video veya erişim hataları düzeltilir. Kontrat hatası çıkarsa aynı adrese patch varsayılmaz; implementation plan'daki iptal/çekim/yeni deployment prosedürü izlenir. Gerekirse proje adresi ve başvuru kanıtları güncellenir. Tamponun önceden “boş” kalacağı varsayılmaz.

## 3. Dört ilerleme kontrolü

| Kontrol | Geçmeden ilerlenmeyecek konu |
|---|---|
| A: Gerçek PQ + digest + Worker uyumu | Ürün UI'ını büyütme |
| B: Tam vault akışı, özellikle çekim ve replay | Kullanılabilir ürün diye sunma |
| C: Restore + UI + agent provası + kritik testler | Fonlu mainnet release |
| D: Mainnet kanıtı + public repo/web + doğru açıklama | Başvuruyu gönderme |

Bunlar kullanıcıdan her adımda izin isteme noktaları değildir; teknik bitiş ölçütleridir. Gerekli yetki mevcutsa geliştirici bir sonraki işe devam eder.

## 4. İşler uzarsa ne kesilir?

1. Görsel cila, ek wallet desteği ve ek dil.
2. Geniş geçmiş taraması; mevcut durum ve sabit demo kanıtları kalır.
3. UI'dan deploy; script ile deploy ve adresle açma kalır.

Toplam bütçe, alıcı/süre/tutar sınırı, hybrid onay, iki freeze yolu, replay/paymentId, şifreli key export/import, geri yükleme testi ve gerçek mainnet kanıtları kesilmez. Otomasyon hatası veya eksik yetki, tamamlanmış özellik gibi gösterilmez.

## 5. Her çalışma sonunda devredilecek durum

`docs/IMPLEMENTATION-STATUS.md` şu bilgileri taşır: commit, biten paket, çalışan komutlar ve sonuçları, test ID'leri, ağ/transaction kanıtları, açık hata, sıradaki somut görev. Bu dosya sırf tarih geçtiği için kutuları tamamlandı yapmaz.

Program bilgisi: [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq). Başvuru şartları ve tarihleri gönderim öncesi tekrar kontrol edilir.
