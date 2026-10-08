(ns repro.core
  (:require
    ["@ms/min-component-library" :as lib]))

;; defonce survives a hot reload and is re-initialised by a full page load.
;; That is what distinguishes the two: after a hot reload the click count and
;; the load timestamp are unchanged, after a refresh they reset.
(defonce state
  (atom {:clicks 0
         :reloads 0
         :loaded-at (.toLocaleTimeString (js/Date.))}))

(defn render! []
  (let [el (js/document.getElementById "app")
        {:keys [clicks reloads loaded-at]} @state]
    (set! (.-innerHTML el)
          (str "<p>library label: <b id='label'>" lib/label "</b></p>"
               "<p>clicks: <b id='clicks'>" clicks "</b>"
               " &nbsp; after-load count: <b id='reloads'>" reloads "</b></p>"
               "<p>page loaded at: <b id='loaded'>" loaded-at "</b></p>"
               "<button id='bump'>click me</button>"))
    (.addEventListener
      (js/document.getElementById "bump") "click"
      (fn [_] (swap! state update :clicks inc) (render!)))))

(defn ^:dev/after-load after-load []
  (swap! state update :reloads inc)
  (js/console.log "[repro] after-load, label =" lib/label)
  (render!))

(defn init []
  (js/console.log "[repro] init, label =" lib/label)
  (render!))
