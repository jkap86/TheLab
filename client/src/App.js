import "./App.css";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LoadingIcon from "./Components/Common/Components/LoadingIcon";
const Homepage = lazy(() => import("./Components/Homepage"));
const Layout = lazy(() => import("./Components/Common/Components/Layout"));
const Leagues = lazy(() => import("./Components/Leagues"));
const Players = lazy(() => import("./Components/Players"));
const Trades = lazy(() => import("./Components/Trades"));

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
                <Layout
                  display={
                    <Suspense fallback={<LoadingIcon />}>
                      <Leagues />
                    </Suspense>
                  }
                />
              }
            ></Route>
            <Route
              path="/players/:username"
              element={
                <Layout
                  display={
                    <Suspense fallback={<LoadingIcon />}>
                      <Players />
                    </Suspense>
                  }
                />
              }
            ></Route>
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
          </Routes>
        </Suspense>
      </BrowserRouter>
    </div>
  );
}

export default App;
