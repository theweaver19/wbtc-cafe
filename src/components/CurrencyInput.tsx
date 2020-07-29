import { WithStyles } from "@material-ui/core";
import Button from "@material-ui/core/Button";
import InputAdornment from "@material-ui/core/InputAdornment";
import Menu from "@material-ui/core/Menu";
import MenuItem from "@material-ui/core/MenuItem";
import { Styles } from "@material-ui/core/styles/withStyles";
import TextField from "@material-ui/core/TextField";
import { withStyles } from "@material-ui/styles";
import React from "react";

import theme from "../theme/theme";
import { MINI_ICON_MAP } from "../utils/walletUtils";

const styles: Styles<typeof theme, any> = () => ({
  amountField: {
    width: "100%",
    // marginBottom: theme.spacing(2)
  },
  endAdornment: {
    "& p": {
      color: "#000",
    },
  },
  item: {
    display: "flex",
    fontSize: 14,
    alignItems: "center",
    minWidth: 55,
    paddingLeft: theme.spacing(1),
    "& div": {
      display: "flex",
      // fontSize: 14
    },
    justifyContent: "flex-end",
  },
  select: {
    display: "flex",
    "& div": {
      display: "flex",
      // fontSize: 14
    },
    "& MuiInput-underline:before": {
      display: "none",
    },
  },
  icon: {
    width: 16,
    height: 16,
    marginRight: theme.spacing(0.75),
  },
});

interface Props extends WithStyles<typeof styles> {
  onCurrencyChange: (newCurrency: string) => void;
  onAmountChange: (newAmount: number) => void;
  items: string[];
  inputRef?: React.RefObject<any>;
  disabled?: boolean;
}

interface State {
  currency: string;
  open: boolean;
}

class CurrencyInput extends React.Component<Props, State> {
  private anchorEl: React.RefObject<any>;
  private defaultInputRef: React.RefObject<any>;

  constructor(props: Props) {
    super(props);
    this.state = {
      currency: "",
      open: false,
    };
    this.anchorEl = React.createRef<any>();
    this.defaultInputRef = React.createRef<any>();
  }

  handleOpen() {
    this.setState({
      open: true,
    });
  }

  handleClose(event: any) {
    // console.log(event, event.target, event.target.value)
    const value = event.target.value;
    if (value) {
      this.props.onCurrencyChange(value);
      this.setState({ currency: value });
    }
    this.setState({ open: false });
  }

  render() {
    const { classes, onAmountChange, items, inputRef } = this.props;

    const { currency, open } = this.state;

    // console.log(currency)

    const selected = currency || items[0];

    return (
      <TextField
        id=""
        className={classes.amountField}
        placeholder="Convert Amount"
        margin="dense"
        variant="outlined"
        onChange={(event) => {
          if (onAmountChange) {
            onAmountChange(Number(event.target.value));
          }
        }}
        inputRef={inputRef || this.defaultInputRef}
        type="number"
        InputProps={{
          endAdornment:
            items && items.length && items.length > 1 ? (
              <InputAdornment position="end">
                <Button
                  ref={this.anchorEl}
                  aria-controls="simple-menu"
                  aria-haspopup="true"
                  onClick={this.handleOpen.bind(this)}
                >
                  <img
                    alt=""
                    role="presentation"
                    src={
                      MINI_ICON_MAP[
                        selected.toLowerCase() as
                          | "btc"
                          | "eth"
                          | "zec"
                          | "dai"
                          | "usdc"
                          | "wbtc"
                      ]
                    }
                    className={classes.icon}
                  />
                  <span>{selected}</span>
                </Button>
                <Menu
                  id="simple-menu"
                  anchorEl={this.anchorEl.current}
                  keepMounted
                  open={open}
                  onClose={this.handleClose.bind(this)}
                >
                  {items.map((i: string, index: number) => (
                    <MenuItem
                      onClick={() => {
                        this.handleClose.bind(this)({
                          target: {
                            value: i,
                          },
                        });
                      }}
                      key={index}
                      value={i}
                    >
                      <img
                        alt=""
                        role="presentation"
                        src={
                          MINI_ICON_MAP[
                            i.toLowerCase() as
                              | "btc"
                              | "eth"
                              | "zec"
                              | "dai"
                              | "usdc"
                              | "wbtc"
                          ]
                        }
                        className={classes.icon}
                      />
                      <span>{i}</span>
                    </MenuItem>
                  ))}
                </Menu>
                {/*<Select
                          className={classes.select}
                          variant='outlined'
                          value={currency || items[0]}
                          onChange={(event) => {
                              onCurrencyChange(event.target.value)
                              this.setState({ currency: event.target.value })
                          }}
                          inputProps={{
                              disableUnderline: true
                          }}
                        >
                        {items.map((i, index) => <MenuItem key={index} value={i}>
                            <img src={MINI_ICON_MAP[i.toLowerCase()]} className={classes.icon} />
                            <span>{i}</span>
                        </MenuItem>)}
                        </Select>*/}
              </InputAdornment>
            ) : (
              <InputAdornment className={classes.endAdornment} position="end">
                {
                  <div className={classes.item}>
                    {
                      <img
                        alt=""
                        role="presentation"
                        src={
                          MINI_ICON_MAP[
                            items[0].toLowerCase() as
                              | "btc"
                              | "eth"
                              | "zec"
                              | "dai"
                              | "usdc"
                              | "wbtc"
                          ]
                        }
                        className={classes.icon}
                      />
                    }
                    <span>{items[0]}</span>
                  </div>
                }
              </InputAdornment>
            ),
        }}
        inputProps={{
          "aria-label": "bare",
          disabled: this.props.disabled,
        }}
      />
    );
  }
}

export default withStyles(styles)(CurrencyInput);
