import React from "react";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import { makeStyles } from "@material-ui/core";

import RenVM from "../assets/renvm-powered.svg";
import { Store } from "../store/store";
import {
  ADAPTER_MAIN,
  ADAPTER_TEST,
  CURVE_MAIN,
  CURVE_TEST,
} from "../utils/environmentVariables";
import { ExternalLink } from "./ExternalLink";

require("dotenv").config();

const useStyles = makeStyles((theme) => ({
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
  },
}));

interface Props {}

export const Footer: React.FC<Props> = () => {
  const classes = useStyles();
  const { selectedNetwork } = Store.useContainer();

  return (
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
          <Typography variant="caption">
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
  );
};
