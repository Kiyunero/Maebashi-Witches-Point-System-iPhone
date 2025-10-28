// 【重要】Firebaseプロジェクト作成時にコピーした設定情報をここに貼り付けます
const firebaseConfig = {
    apiKey: "AIzaSyAxZffh198by405B4t64hTMyEFatYiX92A",
    authDomain: "point-tuika.firebaseapp.com",
    projectId: "point-tuika",
    storageBucket: "point-tuika.firebasestorage.app",
    messagingSenderId: "763384904606",
    appId: "1:763384904606:web:8d7556d0089b5f9f08b48f"
  };

// Firebaseアプリの初期化
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- 設定項目 ---
// スタンプのレイヤー画像
const STAMP_LAYERS = [
    'images/stamp_layer_1.png',
    'images/stamp_layer_2.png',
    'images/stamp_layer_3.png',
    'images/stamp_layer_4.png',
    'images/stamp_layer_5.png', // typoを修正
];

// ▼▼▼ ここから追加 ▼▼▼
// コンプリートに必要なスタンプの数
const STAMP_COMPLETE_COUNT = 1;

// コンプリート時の報酬画像リスト（複数登録可能）
const REWARD_IMAGES = [
    { name: 'コンプリート報酬', url: 'images/special_reward.png' },
    // { name: '追加の報酬画像', url: 'images/special_reward_2.png' }, // 追する場合はこのように記述
];

// コンプリート時の合言葉
const COMPLETE_SECRET_CODE = '123456'; 
// ▲▲▲ ここまで追加 ▲▲▲
// --- 設定項目ここまで ---


function initPwaMap() {
    const app = Vue.createApp({
        data() {
            return {
                loading: true,
                userId: null,
                authToken: null,
                isTokenLoading: false,
                errorMessage: '',
                isScannerVisible: false,
                scanResultMessage: '',
                scanResultClass: '',
                videoStream: null,
                userProfile: null,
                allQuests: [],
                map: null,
                spots: [],
                userListener: null,
                activeInfoWindow: null,
                oshis: [
                    { id: 1, name: 'キャラ1', icon: 'images/oshi_1.png', markerIcon: 'images/oshi1.gif' }, 
                    { id: 2, name: 'キャラ2', icon: 'images/oshi_2.png', markerIcon: 'images/oshi2.gif' },
                    { id: 3, name: 'キャラ3', icon: 'images/oshi_3.png', markerIcon: 'images/oshi3.gif' }, 
                    { id: 4, name: 'キャラ4', icon: 'images/oshi_4.png', markerIcon: 'images/oshi4.gif' },
                    { id: 5, name: 'キャラ5', icon: 'images/oshi_5.png', markerIcon: 'images/oshi5.gif' },
                ],
                myOshi: 1,
                isQuestStartAnimationVisible: false,
                isQuestClearAnimationVisible: false,
                isCompleteScreenVisible: false, 
                rewardImages: REWARD_IMAGES, 
                completeSecretCode: COMPLETE_SECRET_CODE, 
                markerLoadState: 0, 
                // ▼▼▼ data()から mapMarkers を削除 ▼▼▼
            };
        },
        computed: {
            completedQuestCount() {
                if (!this.userProfile || !this.userProfile.questProgress) return 0;
                return Object.values(this.userProfile.questProgress)
                    .filter(status => status === 'completed').length;
            },
            completedStamps() {
                return STAMP_LAYERS.slice(0, this.completedQuestCount);
            },
            isStampCompleted() {
                return this.completedQuestCount >= STAMP_COMPLETE_COUNT;
            },
            inProgressQuests() {
                if (!this.userProfile || !this.userProfile.questProgress || this.allQuests.length === 0) {
                    return [];
                }
                const inProgressQuestIds = Object.keys(this.userProfile.questProgress)
                    .filter(questId => this.userProfile.questProgress[questId] === 'in_progress');
                return this.allQuests.filter(quest => inProgressQuestIds.includes(quest.id));
            },
        },
        async mounted() {
            const savedOshi = localStorage.getItem('myOshi');
            if (savedOshi) {
                this.myOshi = parseInt(savedOshi, 10);
            }

            await this.initializeUser();
            this.loading = false;
            
            // ▼▼▼ ここに mapMarkers の初期化を戻す (元ファイル と同じ) ▼▼▼
            this.mapMarkers = [];

            await this.$nextTick();
            this.initializeMap();

            if (this.isStampCompleted) {
                this.showCompleteScreen();
            }
        },
        methods: {
            async initializeUser() {
                let savedUserId = localStorage.getItem('questAppUserId');
                if (savedUserId) {
                    this.userId = savedUserId;
                } else {
                    savedUserId = this.generateUniqueId();
                    localStorage.setItem('questAppUserId', savedUserId);
                    this.userId = savedUserId;
                }
                await Promise.all([this.fetchAllQuests(), this.fetchAllSpots()]);
                this.attachUserListener();
            },
            generateUniqueId() {
                return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
            },
            attachUserListener() {
                if (this.userListener) {
                    this.userListener();
                }
                const userRef = db.collection("users").doc(this.userId);
                this.userListener = userRef.onSnapshot((doc) => {
                    console.log("スマホアプリ側でユーザーデータの更新を検知しました。");
                    if (doc.exists) {
                        const oldQuestCount = this.completedQuestCount;
                        this.userProfile = doc.data();
                        if (this.isStampCompleted && oldQuestCount < STAMP_COMPLETE_COUNT) {
                           this.showCompleteScreen();
                        }
                    } else {
                        const newUserProfile = { userId: this.userId, questProgress: {}, points: 0 };
                        userRef.set(newUserProfile);
                        this.userProfile = newUserProfile;
                    }
                    if (this.map) {
                        this.placePwaMarkers();
                    }
                });
            },
            initializeMap() {
                const mapElement = document.getElementById('map');
                if (mapElement) {
                    this.map = new google.maps.Map(mapElement, {
                        center: { lat: 36.391618491418384, lng: 139.07080464798733 },
                        zoom: 16.5,
                        gestureHandling: 'greedy'
                    });
                    this.placePwaMarkers();
                } else {
                    console.error('マップ要素が見つかりません。');
                }
            },
            async fetchAllQuests() {
                const questsSnapshot = await db.collection('quests').get();
                this.allQuests = questsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            },
            async fetchAllSpots() {
                const spotsSnapshot = await db.collection('spots').get();
                this.spots = spotsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            },

            placePwaMarkers() {
                const currentLoadId = ++this.markerLoadState;

                const selectedOshiData = this.oshis.find(o => o.id === this.myOshi);
                if (!selectedOshiData) {
                    console.error("選択された推しキャラが見つかりません。");
                    return;
                }
                
                const oshiMarkerIconUrl = selectedOshiData.markerIcon;

                const placeMarkers = (scaledSize) => {
                    if (this.markerLoadState !== currentLoadId) {
                        console.log("古いマーカー読み込み要求を破棄しました。");
                        return; 
                    }

                    // 既存のマーカーをマップから削除
                    this.mapMarkers.forEach(item => item.marker.setMap(null)); // item.marker を参照
                    this.mapMarkers = []; // 配列をリセット

                    this.spots.forEach(spot => {
                        const position = {
                            lat: parseFloat(spot.latitude),
                            lng: parseFloat(spot.longitude)
                        };
                        
                        const questStatus = this.userProfile ? this.userProfile.questProgress[spot.questId] : undefined;
                        const isCompleted = questStatus === 'completed';

                        const marker = new google.maps.Marker({
                            position: position,
                            map: this.map,
                            title: spot.name,
                            icon: {
                                url: oshiMarkerIconUrl,
                                scaledSize: scaledSize, 
                            },
                            opacity: isCompleted ? 0.5 : 1.0,
                            questId: spot.questId // マーカーにクエストIDを持たせる
                        });
                        
                        const destination = `${spot.latitude},${spot.longitude}`;
                        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;

                        const infoWindow = new google.maps.InfoWindow({
                            content: `
                                <div>
                                    <strong>${spot.name}</strong><br>
                                    <a href="${mapsUrl}" target="_blank" class="btn btn-primary btn-sm mt-2">Google マップでナビを開始</a>
                                </div>
                            `
                        });

                        marker.addListener('click', () => {
                            if (this.activeInfoWindow) {
                                this.activeInfoWindow.close();
                            }
                            infoWindow.open(this.map, marker);
                            this.activeInfoWindow = infoWindow;
                        });
                        
                        // マーカー、情報ウィンドウ、クエストIDをセットで保存
                        this.mapMarkers.push({ 
                            marker: marker, 
                            infoWindow: infoWindow, 
                            questId: spot.questId 
                        });
                    });
                };

                const img = new Image();
                img.onload = () => {
                    const MAX_DIMENSION = 50; 
                    let scaledWidth, scaledHeight;

                    if (img.width === 0 || img.height === 0) {
                        scaledWidth = MAX_DIMENSION;
                        scaledHeight = MAX_DIMENSION;
                    } else if (img.width > img.height) {
                        scaledWidth = MAX_DIMENSION;
                        scaledHeight = (img.height / img.width) * MAX_DIMENSION;
                    } else {
                        scaledHeight = MAX_DIMENSION;
                        scaledWidth = (img.width / img.height) * MAX_DIMENSION;
                    }

                    const finalScaledSize = new google.maps.Size(scaledWidth, scaledHeight);
                    placeMarkers(finalScaledSize);
                };

                img.onerror = () => {
                    console.error("マーカー画像のロードに失敗しました: ", oshiMarkerIconUrl);
                    const fallbackSize = new google.maps.Size(42, 42);
                    placeMarkers(fallbackSize);
                };
                
                img.src = oshiMarkerIconUrl; 
            },
            
            setMyOshi(oshiId) {
                this.myOshi = oshiId;
                localStorage.setItem('myOshi', oshiId);
                this.placePwaMarkers();
            },

            focusOnQuestSpot(questId) {
                const spot = this.spots.find(s => s.questId === questId);
                if (!spot) {
                    console.warn(`クエストID ${questId} に関連するスポットが見つかりません。`);
                    return;
                }

                // this.mapMarkers は非リアクティブでも参照可能
                const markerData = this.mapMarkers.find(m => m.questId === questId);
                if (!markerData) {
                    console.warn(`クエストID ${questId} に関連するマーカーが見つかりません。`);
                    return;
                }

                const { marker, infoWindow } = markerData;

                const position = {
                    lat: parseFloat(spot.latitude),
                    lng: parseFloat(spot.longitude)
                };
                this.map.panTo(position);

                if (this.activeInfoWindow) {
                    this.activeInfoWindow.close();
                }
                infoWindow.open(this.map, marker);
                this.activeInfoWindow = infoWindow;
            },

            async generateAuthToken() {
                this.isTokenLoading = true;
                this.authToken = null;
                this.errorMessage = '';
                try {
                    const token = Math.floor(100000 + Math.random() * 900000).toString();
                    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
                    await db.collection('authTokens').doc(token).set({
                        userId: this.userId,
                        expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt)
                    });
                    this.authToken = token;
                } catch (error) {
                    console.error("合言葉の発行に失敗しました: ", error);
                    this.errorMessage = "エラーが発生しました。時間をおいて再度お試しください。";
                } finally {
                    this.isTokenLoading = false;
                }
            },
            async startScanner() {
                this.isScannerVisible = true;
                this.scanResultMessage = '';
                this.$nextTick(async () => {
                    const video = document.getElementById('scanner-video');
                    if (!video) {
                        console.error("スキャナーのvideo要素が見つかりません。");
                        this.isScannerVisible = false;
                        return;
                    }
                    try {
                        this.videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
                        video.srcObject = this.videoStream;
                        video.play();
                        requestAnimationFrame(this.tick.bind(this));
                    } catch (err) {
                        console.error("カメラの起動に失敗:", err);
                        this.scanResultMessage = "カメラの起動に失敗しました。カメラのアクセスを許可してください。";
                        this.scanResultClass = "alert-danger";
                        this.isScannerVisible = false;
                    }
                });
            },
            stopScanner() {
                if (this.videoStream) {
                    this.videoStream.getTracks().forEach(track => track.stop());
                }
                this.isScannerVisible = false;
            },
            tick() {
                if (!this.isScannerVisible) return;
                const video = document.getElementById('scanner-video');
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    const canvasElement = document.createElement('canvas');
                    const canvas = canvasElement.getContext('2d');
                    canvasElement.width = video.videoWidth;
                    canvasElement.height = video.videoHeight;
                    canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
                    const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
                    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
                    if (code) {
                        this.stopScanner();
                        this.handleQrCode(code.data);
                        return;
                    }
                }
                requestAnimationFrame(this.tick.bind(this));
            },
            async handleQrCode(qrCodeValue) {
                try {
                    const userRef = db.collection("users").doc(this.userId);

                    if (qrCodeValue.startsWith('QUEST_START::')) {
                        const questId = qrCodeValue.split('::')[1];
                        
                        if (this.userProfile.questProgress[questId]) {
                            this.scanResultMessage = `このクエストは既に開始済み、またはクリア済みです。`;
                            this.scanResultClass = "alert-warning";
                            return;
                        }

                        await userRef.set({
                            questProgress: { [questId]: "in_progress" }
                        }, { merge: true });

                        this.scanResultMessage = `クエストを開始しました！`;
                        this.scanResultClass = "alert-info";
                        this.playQuestStartAnimation();

                    } else {
                        const questsRef = db.collection("quests");
                        const querySnapshot = await questsRef.where("clearQRCodeValue", "==", qrCodeValue).get();
                        
                        if (querySnapshot.empty) {
                            this.scanResultMessage = "無効なQRコードです。";
                            this.scanResultClass = "alert-warning";
                            return;
                        }

                        const questDoc = querySnapshot.docs[0];
                        const questId = questDoc.id;
                        const questData = questDoc.data();
                        const questPoints = questData.points || 0;

                        if (this.userProfile.questProgress[questId] === 'completed') {
                            this.scanResultMessage = `クエスト「${questData.title}」は既にクリア済みです。`;
                            this.scanResultClass = "alert-warning";
                            return;
                        }
                        
                        await db.runTransaction(async (transaction) => {
                            const userDoc = await transaction.get(userRef);
                            if (!userDoc.exists) {
                                throw "User document not found!";
                            }
                            
                            const currentPoints = userDoc.data().points || 0;
                            const newPoints = currentPoints + questPoints;
                            
                            const newQuestProgress = { ...userDoc.data().questProgress, [questId]: "completed" };

                            transaction.update(userRef, { 
                                questProgress: newQuestProgress,
                                points: newPoints 
                            });
                        });
                        
                        this.scanResultMessage = `クエスト「${questData.title}」をクリア！ ${questPoints}ポイント獲得！`;
                        this.scanResultClass = "alert-success";
                        this.playQuestClearAnimation();
                    }

                } catch (error) {
                    console.error("QRコード処理エラー:", error);
                    this.scanResultMessage = "QRコードの処理中にエラーが発生しました。";
                    this.scanResultClass = "alert-danger";
                }
            },
            playQuestStartAnimation() {
                this.isQuestStartAnimationVisible = true;
                this.$nextTick(() => {
                    const container = document.getElementById('lottie-start-container');
                    container.innerHTML = ''; 
                    const anim = lottie.loadAnimation({
                        container: container,
                        renderer: 'svg',
                        loop: false,
                        autoplay: true,
                        path: 'lottie/quest_start.json'
                    });
                    anim.addEventListener('complete', () => {
                        this.isQuestStartAnimationVisible = false;
                        anim.destroy();
                    });
                });
            },
            playQuestClearAnimation() {
                this.isQuestClearAnimationVisible = true;
                this.$nextTick(() => {
                    const container = document.getElementById('lottie-clear-container');
                    container.innerHTML = '';
                    const anim = lottie.loadAnimation({
                        container: container,
                        renderer: 'svg',
                        loop: false,
                        autoplay: true,
                        path: 'lottie/quest_clear.json'
                    });
                    anim.addEventListener('complete', () => {
                        this.isQuestClearAnimationVisible = false;
                        anim.destroy();
                    });
                });
            },
            showCompleteScreen() {
                this.isCompleteScreenVisible = true;
            },
            closeCompleteScreen() {
                this.isCompleteScreenVisible = false;
            },
            async downloadImage(imageUrl) {
                try {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    const fileName = imageUrl.split('/').pop();
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                } catch (error) {
                    console.error('画像のダウンロードに失敗しました:', error);
                    alert('画像のダウンロードに失敗しました。');
                }
            }
        }
    });
    window.pwaVueApp = app.mount('#app');
}