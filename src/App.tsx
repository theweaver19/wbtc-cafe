import * as queryString from "query-string";
import * as React from "react";

import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import { Styles, WithStyles } from "@material-ui/core/styles/withStyles";
import Typography from "@material-ui/core/Typography";
import { ThemeProvider, withStyles } from "@material-ui/styles";
import { createStore, withStore } from "@spyna/react-store";
import Marquee from "react-smooth-marquee";

import RenVM from "./assets/renvm-powered.svg";
import { ExternalLink } from "./components/ExternalLink";
import CancelModalContainer from "./containers/CancelModalContainer";
import DepositModalContainer from "./containers/DepositModalContainer";
import NavContainer from "./containers/NavContainer";
import NetworkModalContainer from "./containers/NetworkModalContainer";
import SwapRevertModalContainer from "./containers/SwapRevertModalContainer";
import TransactionsTableContainer from "./containers/TransactionsTableContainer";
import TransferContainer from "./containers/TransferContainer";
import ViewGatewayContainer from "./containers/ViewGatewayContainer";
import { storeListener } from "./services/storeService";
import { initialState, StoreProps } from "./store/store";
import theme from "./theme/theme";
import { updateRenVMFees } from "./utils/txUtils";
import { initDataWeb3, setNetwork } from "./utils/walletUtils";
import {
  ADAPTER_MAIN,
  ADAPTER_TEST,
  CURVE_MAIN,
  CURVE_TEST,
} from "./utils/web3Utils";

require("dotenv").config();

const styles: Styles<typeof theme, {}> = () => ({
  container: {
    maxWidth: 450,
  },
  contentContainer: {
    paddingTop: theme.spacing(3),
  },
  footerContainer: {
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(3),
    fontSize: 10,
    "& a": {
      color: "#333",
      marginRight: theme.spacing(2),
    },
  },
  footerLogo: {
    height: 32,
    width: "auto",
    marginRight: theme.spacing(2),
    // border: '1px solid ' + theme.palette.divider,
    // borderRadius: 4
  },
  transfersContainer: {
    padding: theme.spacing(3),
  },
  disclosure: {
    "& div": {
      border: "0.5px solid " + theme.palette.divider,
      background: "#fff",
      // height: '100%',
      paddingTop: theme.spacing(1.5),
      paddingBottom: theme.spacing(1),
      paddingLeft: theme.spacing(2),
      paddingRight: theme.spacing(2),
      fontSize: 12,

      "& div": {
        border: "none",
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      },
    },
    // '& '
  },
});

interface Props extends WithStyles<typeof styles>, StoreProps {}

const App: React.FC<Props> = ({ store, classes }) => {
  React.useEffect(() => {
    const params = queryString.parse(window.location.search);
    store.set("queryParams", params);

    // default to mainnet
    setNetwork(params.network === "testnet" ? "testnet" : "mainnet").catch(
      console.error,
    );

    initDataWeb3().catch(console.error);
    updateRenVMFees().catch(console.error);
  }, []); //eslint-disable-line react-hooks/exhaustive-deps

  storeListener(store);
  const selectedNetwork = store.get("selectedNetwork");

  return (
    <ThemeProvider theme={theme}>
      <DepositModalContainer />
      <CancelModalContainer />
      <ViewGatewayContainer />
      <NetworkModalContainer />
      <SwapRevertModalContainer />
      <NavContainer />
      <Container fixed maxWidth="lg">
        <Grid container className={classes.contentContainer} spacing={2}>
          <Grid item xs={12} className={classes.disclosure}>
            <Marquee>
              Welcome to the WBTC Cafe! This is a new project, so please use
              caution.
            </Marquee>
          </Grid>
          <Grid item xs={12} sm={12} md={4}>
            <TransferContainer />
          </Grid>
          <Grid
            item
            xs={12}
            sm={12}
            md={8}
            className={classes.transfersContainer}
          >
            <TransactionsTableContainer />
          </Grid>
        </Grid>
      </Container>
      <Grid container className={classes.footerContainer}>
        <Container fixed maxWidth="lg">
          <Grid container alignItems="center" justify="flex-start">
            <ExternalLink href={"https://renproject.io"}>
              <img
                alt="Powered by RenVM"
                className={classes.footerLogo}
                src={RenVM}
              />
            </ExternalLink>
            <Typography className={classes.footerLinks} variant="caption">
              <ExternalLink
                href={
                  "https://" +
                  (selectedNetwork === "testnet" ? "kovan." : "") +
                  "etherscan.io/address/" +
                  (selectedNetwork === "testnet" ? ADAPTER_TEST : ADAPTER_MAIN)
                }
              >
                Contract
              </ExternalLink>{" "}
              <ExternalLink
                href={
                  "https://" +
                  (selectedNetwork === "testnet" ? "kovan." : "") +
                  "etherscan.io/address/" +
                  (selectedNetwork === "testnet" ? CURVE_TEST : CURVE_MAIN)
                }
              >
                Liquidity Pool
              </ExternalLink>{" "}
              <ExternalLink href={"https://www.curve.fi/ren"}>
                Swap renBTC → WBTC
              </ExternalLink>
            </Typography>
          </Grid>
        </Container>
      </Grid>
    </ThemeProvider>
  );
};

export default createStore(withStore(withStyles(styles)(App)), initialState);
