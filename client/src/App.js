// src/App.js
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import CalendarPage from "./routes/CalendarPage";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CalendarPage />} />
      </Routes>
    </Router>
  );
}

export default App;
