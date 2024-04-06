import "./App.css";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LoadingIcon from "./Components/Common/Components/LoadingIcon";
const Homepage = lazy(() => import("./Components/Homepage"));
const Layout = lazy(() => import("./Components/Common/Components/Layout"));
const Leagues = lazy(() => import("./Components/Leagues"));
const Players = lazy(() => import("./Components/Players"));
const Leaguemates = lazy(() => import("./Components/Leaguemates"));
const Trades = lazy(() => import("./Components/Trades"));
const PickTracker = lazy(() => import("./Components/Picktracker"));

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Suspense fallback={<LoadingIcon />}>
          <Routes>
            <Route path="/" element={<Homepage />}></Route>
            <Route
              path="/leagues/:username"
              element={
                <Suspense fallback={<LoadingIcon />}>
                  <Layout
                    display={
                      <Suspense fallback={<LoadingIcon />}>
                        <Leagues />
                      </Suspense>
                    }
                  />
                </Suspense>
              }
            ></Route>
            <Route
              path="/players/:username"
              element={
                <Suspense fallback={<LoadingIcon />}>
                  <Layout
                    display={
                      <Suspense fallback={<LoadingIcon />}>
                        <Players />
                      </Suspense>
                    }
                  />
                </Suspense>
              }
            ></Route>
            <Route
              path="/leaguemates/:username"
              element={
                <Suspense fallback={<LoadingIcon />}>
                  <Layout
                    display={
                      <Suspense fallback={<LoadingIcon />}>
                        <Leaguemates />
                      </Suspense>
                    }
                  />
                </Suspense>
              }
            />
            <Route
              path="/trades/:username"
              element={
                <Layout
                  display={
                    <Suspense fallback={<LoadingIcon />}>
                      <Trades />
                    </Suspense>
                  }
                />
              }
            ></Route>
            <Route
              path="/picktracker/:league_id"
              element={
                <Suspense fallback={<LoadingIcon />}>
                  <PickTracker />
                </Suspense>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </div>
  );
}

export default App;
