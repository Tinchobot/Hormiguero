// =====================================
// Configuración de Hormiguero.
//
// googleClientId: el "ID de cliente de OAuth" (aplicación web) del
// proyecto Hormiguero en Google Cloud. No es secreto: identifica a la
// app ante Google y solo funciona desde los orígenes autorizados
// (https://tinchobot.github.io y http://localhost:8642).
// Vacío = Hormiguero funciona solo con el guardado local.
// =====================================

globalThis.Hormiguero ||= {};
globalThis.Hormiguero.config = {
    googleClientId: "735170492887-8si9uuaa87v3jf70dj8e528itf5ce81j.apps.googleusercontent.com",
};
