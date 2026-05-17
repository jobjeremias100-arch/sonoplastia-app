// =============================================================================
// firebase-config.js
// Arquivo de configuração central do Firebase.
// Inicializa o app e exporta as instâncias do Firestore e Storage.
// =============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =============================================================================
// ⚠️  ATENÇÃO: INSIRA SUAS CREDENCIAIS DO FIREBASE ABAIXO
// Para obter essas credenciais:
// 1. Acesse https://console.firebase.google.com/
// 2. Selecione seu projeto (ou crie um novo)
// 3. Vá em Configurações do Projeto > Seus apps > SDK de configuração
// 4. Copie e cole o objeto firebaseConfig abaixo
// =============================================================================
const firebaseConfig = {
  apiKey:            "AIzaSyBhuS2gRNXor-uzXXMrwFVipKdoHRoLX6c",
  authDomain:        "sonoplastia-igreja-f1fc0.firebaseapp.com",
  projectId:         "sonoplastia-igreja-f1fc0",
  storageBucket:     "sonoplastia-igreja-f1fc0.firebasestorage.app",
  messagingSenderId: "586681648391",
  appId:             "1:586681648391:web:98b87797ed468f801df1a2",
};
// =============================================================================

// Inicializa o Firebase App
const app = initializeApp(firebaseConfig);

// Exporta apenas o Firestore (Storage não é necessário no plano Spark)
export const db = getFirestore(app);
