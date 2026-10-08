(ns repro.core
  (:require
    ["@ms/min-component-library" :as lib]))

(defn render! []
  (set! (.-textContent (js/document.getElementById "app")) lib/label)
  (js/console.log "[repro] label =" lib/label))

(defn ^:dev/after-load after-load []
  (js/console.log "[repro] after-load")
  (render!))

(defn init []
  (js/console.log "[repro] init")
  (render!))
