import React from "react";
import ReactDOM from "react-dom";
import { ThemeProvider } from "@material-ui/core";

import { App } from "./App";
import "./index.css";
import * as serviceWorker from "./serviceWorker";
import { Store } from "./store/store";
import { TransactionStore } from "./store/transactionStore";
import { Web3Store } from "./store/web3Store";
import { theme } from "./theme/theme";
import { Transaction } from "./types/transaction";
import { newDefaultDatabase } from "./utils/database/defaultDatabase";
import { FeeStore } from "./store/feeStore";

const database = newDefaultDatabase<Transaction>();

ReactDOM.render(
  <Store.Provider initialState={database}>
    <FeeStore.Provider>
      <TransactionStore.Provider>
        <Web3Store.Provider>
          <ThemeProvider theme={theme}>
            <App />
          </ThemeProvider>
        </Web3Store.Provider>
      </TransactionStore.Provider>
    </FeeStore.Provider>
  </Store.Provider>,
  document.getElementById("root")
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
