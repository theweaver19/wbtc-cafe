import Button from "@material-ui/core/Button";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import { Styles, WithStyles } from "@material-ui/core/styles/withStyles";
import Typography from "@material-ui/core/Typography";
import { withStyles } from "@material-ui/styles";
import { withStore } from "@spyna/react-store";
import classNames from "classnames";
import React from "react";

import CafeLogo from "../assets/cafe-logo.svg";
import { StoreProps } from "../store/store";
import theme from "../theme/theme";
import { initLocalWeb3 } from "../utils/walletUtils";

const styles: Styles<typeof theme, {}> = () => ({
  navContainer: {
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(4),
    minHeight: 52,
    borderBottom: "0.5px solid " + theme.palette.divider,
    backgroundColor: "#fff",
  },
  logo: {
    height: 22,
    width: "auto",
    marginRight: theme.spacing(1),
  },
  cafe: {
    fontFamily: "Alex Brush",
    marginLeft: theme.spacing(0.5),
    fontSize: 15,
  },
  aboutButton: {
    marginRight: theme.spacing(1),
    "& svg": {
      height: "0.7em",
      marginRight: theme.spacing(0.25),
    },
  },
  accountButton: {
    fontSize: 12,
    "& svg": {
      marginRight: theme.spacing(1),
    },
    [theme.breakpoints.down("xs")]: {
      width: "100%",
      marginTop: theme.spacing(2),
    },
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },
  title: {
    fontSize: 16,
    textAlign: "center",
  },
  faq: {
    marginRight: theme.spacing(2),
  },
  hideMobile: {
    [theme.breakpoints.down("xs")]: {
      display: "none",
    },
  },
  disabled: {
    pointer: "inherit",
    borderColor: "transparent",
    "&:hover": {
      background: "#fff",
    },
  },
  addressLabel: {
    paddingTop: theme.spacing(1),
    paddingBottom: theme.spacing(1),
  },
  actionsContainer: {
    justifyContent: "flex-end",
    alignItems: "center",
    [theme.breakpoints.down("xs")]: {
      justifyContent: "flex-start",
    },
  },
});

interface Props extends WithStyles<typeof styles>, StoreProps {}

const NavContainer: React.FC<Props> = ({ store, classes }) => {
  const walletAddress = store.get("localWeb3Address");
  const walletConnectError = store.get("walletConnectError");
  const fsUser = store.get("fsUser");
  const validUser = fsUser && fsUser.uid;

  const isSignedIn =
    walletAddress && walletAddress.length && !walletConnectError && validUser;
  const balance = store.get("wbtcBalance");

  return (
    <Grid item xs={12} className={classes.navContainer}>
      {/* @ts-ignore: no property "size" (TODO) */}
      <Container size="lg">
        {
          <Grid container alignItems="center">
            <Grid item xs={12} sm={4}>
              <Grid container alignItems="center">
                <div>
                  <img
                    alt="WBTC Cafe"
                    className={classes.logo}
                    src={CafeLogo}
                  />
                </div>
              </Grid>
            </Grid>
            <Grid item xs={12} sm={8}>
              <Grid className={classes.actionsContainer} container>
                {isSignedIn && (
                  <div className={classes.faq}>
                    <Typography variant="caption">
                      Balance: {balance} WBTC
                    </Typography>
                  </div>
                )}
                {!isSignedIn ? (
                  <Button
                    variant="outlined"
                    onClick={() => {
                      if (!isSignedIn) {
                        initLocalWeb3().catch(console.error);
                      }
                    }}
                    disableRipple={true}
                    size="large"
                    className={classNames(classes.accountButton)}
                  >
                    {<span>Connect Wallet</span>}
                  </Button>
                ) : (
                  <Typography
                    variant="caption"
                    className={classes.addressLabel}
                  >
                    {walletAddress.slice(0, 7) +
                      "..." +
                      walletAddress.slice(walletAddress.length - 5)}
                  </Typography>
                )}
              </Grid>
            </Grid>
          </Grid>
        }
      </Container>
    </Grid>
  );
};

export default withStyles(styles)(withStore(NavContainer));
