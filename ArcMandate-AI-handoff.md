# ArcMandate — Kodlama yapay zekâsına başlangıç mesajı

Bu mesajı aşağıdaki iki dosyayla birlikte yeni yapay zekâya gönder:

1. `ArcMandate-implementation-plan.md` — kapsam, kesin teknik davranışlar ve kabul testleri.
2. `ArcMandate-roadmap.md` — iş paketleri ve hedef takvim.

İlk dosya tek başına da yeterli teknik bağlamı içerir. Eski plan/jüri değerlendirmesi gerekli değildir; eski dosyalar verilecekse güncel şartnameyle çelişen kararların geçerli olmadığı belirtilmelidir.

---

ArcMandate projesini ekli implementation plan ve roadmap'e göre geliştirmeye başla. Önce mevcut repo, çalışma ortamı ve varsa yerel talimatları incele. Var olan kodun durumunu doğrula; çalışan parçaları koru. Repo boşsa plandaki sade yapıyı kur.

Ürün: Arc üzerinde tek bir agent'a yenilenmeyen toplam USDC bütçesi, işlem tavanı, alıcı listesi ve süre veren immutable vault. Yeni oturum ve çekim owner wallet + SLH-DSA imzası ister. Owner veya PQ anahtarı oturumu iptal edebilir. Aynı agent'a yeni oturum açılsa bile eski session'ın işlemleri çalışmamalı.

Öncelikli teknik kaynak `ArcMandate-implementation-plan.md`. Exact digest, Authorization/Policy yapıları, sessionId/controlNonce geçişleri, keyfile ve T01–T16 testlerini uygula. Ağ/kütüphane varsayımı gerçek kaynak veya küçük testle yanlışlanırsa farkı ve çözümü `docs/DECISIONS.md` içine yaz. Güvenlik modelini sessizce gevşetme.

P0 ile başlayıp bağımlılık sırasıyla ilerle. İlk teknik hedef: JS/Solidity digest uyumu, tarayıcı Worker çıktısının gerçek Arc PQ verifier tarafından doğrulanması; ardından fonla → start → pay → freeze → withdraw akışı. Withdraw'u son güne bırakma. Mevcut spike veya önceki sohbetin “çalışıyor” iddiası, mevcut kod/test çıktısı olmadan tamamlanmış aşama sayılmaz.

MVP'ye offline signer, factory, backend, relayer servisi, x402, LLM, recovery, günlük limit, onchain talep kuyruğu veya özel deposit ekleme. Şifreli key export/import ve gerçekten dosyadan restore testi zorunlu. Web tek sayfa; demo agent ayrı Node/TS script'i. Mainnet öncesinde testleri, build artifact'lerini, gerçek Arc provasını ve release paketini tamamla.

Her pakette uygulama ve ilgili testleri birlikte yap. `docs/IMPLEMENTATION-STATUS.md` dosyasını tamamlanan iş, gerçek test komutları/sonuçları, açık hata ve sıradaki görevle güncelle. Kullanıcıya kısa ve anlamlı ilerleme bilgisi ver. Teknik kabul kontrolleri kullanıcı onay kapısı değildir; gerekli yetki mevcutsa devam et.

Gerekli hesap, fon veya yayın yetkisi eksikse bağımsız yerel işleri tamamla; yapılacak işlem, hedef adres/ağ ve maliyet tahmini hazır olduğunda somut eksik bilgiyi iste. Kullanıcının private key/parolasını sohbete yazmasını isteme. Secret'ları repo'ya, frontend bundle'a veya kanıt dosyalarına koyma. Gerçek para harcama ve yayın işlemlerini oturumda verilmiş yetki kapsamında yap.

Simülasyon reddi ile mined revert'i ayır. Çalışmamış test, deployment, source verification veya başvuruyu yapılmış gibi raporlama. Mainnet kontrat hatasında immutable kontratın aynı adreste değiştirilemeyeceğini dikkate al.

İlk yanıtında mevcut ortamı ve ilk iş paketini kısaca belirt, ardından uygulamaya geç. Yeni bir genel fikir/roadmap yazmakla yetinme. Her tamamlanan bölümde değişen dosyaları, anlamlı doğrulama sonuçlarını ve kalan gerçek engelleri raporla.
